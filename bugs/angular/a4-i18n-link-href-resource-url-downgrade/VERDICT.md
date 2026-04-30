# A4 i18n Link Href ResourceURL Downgrade

Status: `CONFIRMED-DOWNGRADE / CONFIRMED-BROWSER-FETCH / NOT-XSS`

## Summary

Angular normally treats `link|href` as `SecurityContext.RESOURCE_URL`.

Baseline checks confirm that these templates throw `NG0904` for a plain string URL:

- `<link href="{{httpUrl}}">`
- `<link [href]="httpUrl">`
- `<link [attr.href]="httpUrl">`
- `<div i18n><link href="{{httpUrl}}"></div>`

However this template renders and writes the plain string:

```html
<link href="{{httpUrl}}" i18n-href>
```

Observed output:

```html
<link href="http://attacker.example/poc.js">
```

This is a separate A4 sink from the host-binding casing issue. The vulnerable path is direct
translated attribute interpolation through `i18nAttributesFirstPass()`.

## Root Cause

Compiler/schema side:

- `packages/compiler/src/schema/dom_security_schema.ts` marks `link|href` as `RESOURCE_URL`.
- `packages/compiler/src/render3/view/i18n/meta.ts:201-218` blocks translated attributes only when
  `isTrustedTypesSink(tag, attr)` is true.
- `packages/compiler/src/schema/trusted_types_sinks.ts` includes `embed|src`, `iframe|src`,
  `object|data`, and `object|codebase`, but not `link|href`.

Runtime i18n side:

- `packages/core/src/render3/i18n/i18n_parse.ts:385-391` selects `_sanitizeUrl` for
  `SENSITIVE_ATTRS[attrName.toLowerCase()]`.
- `SENSITIVE_ATTRS` includes `href`, but this path cannot distinguish `a|href` from `link|href`.

Result: `link|href` goes through URL sanitization instead of ResourceURL enforcement in the direct
`i18n-href` interpolation path.

## Browser Validation

See `evidence/2026-04-28-browser-rel-validation.md`.

In a normal Angular app, with no `DomSanitizer`, no `bypassSecurityTrustResourceUrl`, no custom
directive, and no manual DOM writes, the vulnerable `i18n-href` path renders attacker-controlled
`link[href]` values into the DOM.

Important boundary:

- Static `<link rel="stylesheet" href="{{stylesheetUrl}}" i18n-href>` is blocked at build time with
  `NG2008: Could not find stylesheet file '{{ stylesheetUrl }}' linked from the template.`
- Dynamic `<link rel="{{stylesheetRel}}" href="{{stylesheetUrl}}" i18n-href>` builds, renders, and
  Chrome fetches the remote stylesheet.
- Static `rel=preload` and `rel=modulepreload` build, render, and Chrome fetches the remote JS/module
  assets, but no direct execution was observed.
- Static `rel=manifest` and `rel=icon` rendered in the component body, but no browser fetch was
  observed in the tested headless Chrome run.

## Impact

Confirmed impact is a bypass of Angular's `SafeResourceUrl` requirement for direct translated
`link href` interpolations.

Current severity should not be treated as High: browser validation confirms remote resource fetch,
not script execution. The strongest demonstrated default-app impact is remote stylesheet loading
when `rel` is not the static string `stylesheet`.

Practical impact classes still worth investigating:

- UI integrity/control through attacker CSS.
- Cache/preload poisoning or request forgery side effects through `preload` / `modulepreload`.
- CSP or Trusted Types policy bypass implications.

## Current Verdict

`CONFIRMED-DIVERGENCE` from Angular's own security schema:

- Expected: plain string rejected as ResourceURL, same as normal `<link href="{{httpUrl}}">`.
- Observed: direct `i18n-href` interpolation writes the URL.

Not `CONFIRMED-XSS`.
