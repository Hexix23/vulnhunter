# A3 Host Binding ResourceURL Case Downgrade

Status: `CONFIRMED-DOWNGRADE / CONDITIONAL-EXPLOITABILITY / BROWSER-IMPACT-PENDING`

## Summary

`ɵɵsanitizeUrlOrResourceUrl()` selects `ResourceURL` vs `URL` using `getUrlSanitizer(tag, prop)`.
The compiler schema is case-insensitive for security context lookup, but the runtime helper compares
`tag` and `prop` against `RESOURCE_MAP` without normalizing case.

For host bindings, Angular calls the sanitizer through:

- `packages/compiler/src/template/pipeline/src/phases/resolve_sanitizers.ts`: ambiguous host `src`/`href` receives `ɵɵsanitizeUrlOrResourceUrl`.
- `packages/core/src/render3/instructions/shared.ts`: `setElementAttribute(..., tNode.value, name, value, sanitizer)` passes the template tag name into the sanitizer.
- `packages/core/src/sanitization/sanitization.ts`: `getUrlSanitizer(tag, prop)` uses `RESOURCE_MAP[tag]?.[prop]`.

Observed result: a directive host binding `[attr.src]` on lowercase `<iframe>` throws `NG0904`, while the same directive on uppercase `<IFRAME>` accepts a plain string and writes it to `src`.
The same downgrade occurs for lowercase `<iframe>` with uppercase host binding spelling `[attr.SRC]`.

Expanded matrix results show the same class affects:

- `iframe|src`
- `embed|src`
- `frame|src`
- `base|href`
- `link|href`

The same matrix showed `object|data` and `object|codebase` remain protected, and `script|src`,
`script|href`, and `script|xlink:href` are not rendered by render3 templates.

The same shape was validated in Angular's real `dev-app` application target. The app test rendered
`<IFRAME id="poc-frame" [appUnsafeFrameSrc]="attackerFrameUrl">` and observed the plain string
`src` value. `//dev-app:build` also completed successfully.

## Invariant

Security-sensitive tag and attribute matching must be case-insensitive everywhere that dispatches
between `SecurityContext.URL` and `SecurityContext.RESOURCE_URL`.

The compiler side explicitly follows this invariant in `DomElementSchemaRegistry.securityContext()`;
`isTrustedTypesSink()` also lowercases both inputs. `getUrlSanitizer()` does not.

## PoC

See `poc/host-binding-uppercase-iframe.spec.ts`.

The important shape is:

```ts
@Directive({
  selector: '[unsafeResourceUrlHostBindingDir]',
  host: {'[attr.src]': 'value'},
})
class UnsafeResourceUrlDir {
  value: any = 'http://server';
}

@Component({
  template: `<IFRAME unsafeResourceUrlHostBindingDir></IFRAME>`,
})
class App {}
```

Expected security behavior: throw `NG0904: unsafe value used in a resource URL context`.

Observed behavior: no throw; `iframe.getAttribute('src') === 'http://server'`.

## Impact Notes

This is a policy downgrade from `ResourceURL` to `URL` for ambiguous host bindings when the template
preserves non-lowercase tag or attribute names.

Current severity estimate: `Low-to-Medium` as a standalone framework bug, rising to `Medium` if a
real application/library exposes attacker-controlled URL data through a generic host-binding
directive onto ResourceURL-bearing elements (`iframe`, `embed`, `base`, `link`). It is not yet
enough to claim `High/Critical` XSS because:

- Angular templates are trusted code.
- URL sanitizer still blocks `javascript:` style payloads.
- A direct `script[src]` escalation was probed and did not render, because Angular render3 ignores
  `<script>` elements in templates.
- SVG `script[href]` / `script[xlink:href]` did not produce a direct script-loading escalation in
  the host-binding probe.
- Element-qualified iframe directives and component host bindings on iframe were protected in the
  normal lowercase case.
- Public/common host-binding patterns found so far mostly target `img[src]` and `a[href]`, which
  are URL sinks, not ResourceURL sinks.

The concrete demonstrated impact is bypassing Angular's explicit `SafeResourceUrl` requirement and
loading an arbitrary plain-string remote URL in multiple ResourceURL sinks (`iframe`, `embed`,
`frame`, `base`, `link`).

Still, it violates Angular's own case-insensitive security invariant and crosses a real runtime sink.

Practical exploitability is therefore conditional, not default:

- Generic directive `[foo]` + host `[attr.src]` or `[attr.href]` + ResourceURL element + attacker URL:
  exploitable as ResourceURL policy bypass.
- Element-qualified directive such as `iframe[foo]` in normal lowercase templates: currently
  protected.
- Component host binding on known iframe host: protected.

Escalation target before claiming higher severity:

- `base|href`: navigation/resource resolution integrity impact.
- `link|href`: stylesheet/preload/modulepreload/browser-specific execution or credential impact.
- `embed|src`: modern browser content/plugin behavior impact.
- CSP/Trusted Types: whether Angular's downgrade bypasses production policy assumptions beyond the
  internal `SafeResourceUrl` check.

## Proposed Fix

Normalize inputs in `getUrlSanitizer()`:

```ts
export function getUrlSanitizer(tag: string, prop: string) {
  const isResource = RESOURCE_MAP[tag.toLowerCase()]?.[prop.toLowerCase()] === true;
  return isResource ? ɵɵsanitizeResourceUrl : ɵɵsanitizeUrl;
}
```

Regression coverage should include:

- direct `ɵɵsanitizeUrlOrResourceUrl('http://server', 'IFRAME', 'src')` throws `NG0904`.
- direct `ɵɵsanitizeUrlOrResourceUrl('http://server', 'iframe', 'SRC')` throws `NG0904`.
- host binding `[attr.src]` on `<IFRAME>` throws the same as lowercase `<iframe>`.
- host binding `[attr.SRC]` on `<iframe>` throws the same as lowercase `[attr.src]`.
- equivalent coverage for `embed|src`, `frame|src`, `base|href`, and `link|href`.
