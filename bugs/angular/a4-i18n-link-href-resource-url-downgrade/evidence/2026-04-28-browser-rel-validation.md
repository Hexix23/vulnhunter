# Browser Rel Validation

Date: 2026-04-28

## Goal

Validate whether the `link[href]` ResourceURL downgrade is reachable in a normal Angular app and
whether real browser behavior gives it practical impact.

## App shape

Tested in Angular's own `dev-app` with normal template interpolation. No `DomSanitizer`, no
`bypassSecurityTrustResourceUrl`, no custom directive, and no manual DOM writes were used.

Dynamic stylesheet case:

```html
<link id="poc-stylesheet" rel="{{ stylesheetRel }}" href="{{ stylesheetUrl }}" i18n-href>
```

Static non-stylesheet cases:

```html
<link id="poc-preload" rel="preload" as="script" href="{{ preloadUrl }}" i18n-href>
<link id="poc-modulepreload" rel="modulepreload" href="{{ modulePreloadUrl }}" i18n-href>
<link id="poc-manifest" rel="manifest" href="{{ manifestUrl }}" i18n-href>
<link id="poc-icon" rel="icon" href="{{ iconUrl }}" i18n-href>
```

## Important negative control: static stylesheet rel

This template does not build:

```html
<link id="poc-stylesheet" rel="stylesheet" href="{{ stylesheetUrl }}" i18n-href>
```

Observed Angular build failure:

```text
NG2008: Could not find stylesheet file '{{ stylesheetUrl }}' linked from the template.
```

Interpretation: Angular has a separate build-time resource resolution defense for static
component-template stylesheets. The direct `i18n-href` downgrade is still present, but the most
obvious static `rel=stylesheet` shape is blocked before browser execution.

## Browser validation

Because the OrbStack devserver port was not reachable from the host browser, the app was compiled
with Angular/Bazel and the generated `dist/browser` bundle was served from a host local HTTP server.
Chrome headless loaded the compiled Angular app at:

```text
http://127.0.0.1:4202/index.csr.html
```

Chrome DOM output included the rendered attacker-controlled links:

```html
<link id="poc-stylesheet" rel="stylesheet" href="http://127.0.0.1:9876/style.css?rel=stylesheet">
<link id="poc-preload" rel="preload" as="script" href="http://127.0.0.1:9876/preload.js?rel=preload">
<link id="poc-modulepreload" rel="modulepreload" href="http://127.0.0.1:9876/module.js?rel=modulepreload">
<link id="poc-manifest" rel="manifest" href="http://127.0.0.1:9876/manifest.webmanifest?rel=manifest">
<link id="poc-icon" rel="icon" href="http://127.0.0.1:9876/icon.svg?rel=icon">
```

Attacker asset server observed:

```text
GET /style.css?rel=stylesheet HTTP/1.1" 200 -
GET /preload.js?rel=preload HTTP/1.1" 200 -
GET /module.js?rel=modulepreload HTTP/1.1" 200 -
```

No requests were observed for `manifest.webmanifest` or `icon.svg` in this body-level component
template shape during the headless Chrome run.

## Result by rel

| rel | Angular default app result | Browser result | Execution? |
|---|---|---|---|
| `stylesheet` static | Build blocked by `NG2008` | Not reached | No |
| `stylesheet` via normal interpolation | Builds and renders | Fetches attacker CSS as a stylesheet resource | No JS execution |
| `preload` static | Builds and renders | Fetches attacker JS as preload | No direct execution observed |
| `modulepreload` static | Builds and renders | Fetches attacker module | No direct execution observed |
| `manifest` static | Builds and renders | No fetch observed in this shape | No |
| `icon` static | Builds and renders | No fetch observed in this shape | No |

## Impact conclusion

The downgrade is exploitable in the sense that a normal Angular component can be made to emit a
remote `link[href]` that Angular's ResourceURL policy should reject, and Chrome will fetch remote
stylesheet/preload/modulepreload resources.

This is not currently confirmed as XSS or script execution. The strongest default-app impact shown
so far is remote stylesheet loading when `rel` is also dynamic or otherwise not statically visible
to Angular's stylesheet resolver. Static `rel=preload` and `rel=modulepreload` produce network fetch
and cache/preload effects, but not execution by themselves.
