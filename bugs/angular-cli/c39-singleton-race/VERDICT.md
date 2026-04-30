REFUTED

Confirmed empirically via runtime probes against the canonical `ng new --ssr` + `ng build` bundle (Node 22.22.2, Angular CLI 21.2.8).

## Probes

Server: `node poc/c39-poc/dist/c39-poc/server/server.mjs` (Express + Angular SSR engine), env `NG_ALLOWED_HOSTS=localhost PORT=4000`. Restarted between every probe set so the singleton starts undefined each time.

Component (`poc/c39-poc/src/app/app.ts:9`):
```ts
auth = inject(REQUEST, { optional: true })?.headers.get('Authorization') ?? 'NONE';
```
Template (`poc/c39-poc/src/app/app.html:6`): `<p data-bearer>BEARER={{auth}}</p>`
Route (`poc/c39-poc/src/app/app.routes.server.ts:6`): `RenderMode.Server`.

### baseline (one request, fresh server)
```
BEARER=Bearer A
```

### control (sequential A then B on a fresh server)
```
control_A: BEARER=Bearer A
control_B: BEARER=Bearer B
```

### exploit ×5 (cold-start, two concurrent first-requests)
```
trial 1: A=[hasA:true,hasB:false] B=[hasA:false,hasB:true]
trial 2: A=[hasA:true,hasB:false] B=[hasA:false,hasB:true]
trial 3: A=[hasA:true,hasB:false] B=[hasA:false,hasB:true]
trial 4: A=[hasA:true,hasB:false] B=[hasA:false,hasB:true]
trial 5: A=[hasA:true,hasB:false] B=[hasA:false,hasB:true]
```

No trial showed cross-bearer contamination. Each response contained only its own `Authorization` header.

## Why (matches static analysis from WALKTHROUGH.md)

- The `AngularServerApp` singleton constructor (`packages/angular/ssr/src/app.ts:114-125`) is synchronous. The `??=` at app.ts:504 completes before the first `await`, so a second concurrent caller observes the fully-constructed singleton.
- `handleRendering()` (app.ts:291-323) builds `platformProviders` as a function-local array and binds `REQUEST` (app.ts:312), `REQUEST_CONTEXT`, and `RESPONSE_INIT` from the per-call `request` argument. None of these are stored on `this`.
- `renderAngular()` (utils/ng.ts:68) creates a fresh `platformServer` per call with the per-call providers. The injector is local to that call.
- `envInjector.get(REQUEST, ...)` (utils/ng.ts:124-126) resolves the token from the render-local injector — never from a shared one.
- The only mutable singleton fields written during request handling are `this.router` (app.ts:185) and `this.boostrap` (app.ts:339), both of which hold non-request data (route table, bootstrap function), not request identity.

The runtime probes empirically confirm this: even with two concurrent first-requests against a cold-start singleton, request-scoped data (Authorization header) is correctly partitioned between renders.

## Status

Closed. C39 contributes no primitive; both Shape A (init race) and Shape B (reuse contamination) are structurally and empirically impossible against the shipped bundle.

## Infra notes (relevant to next probes)

- macOS lacks `timeout`; use `gtimeout` from `brew install coreutils`.
- Node v25 SIGABRTs in Angular CLI 21 build (engines field excludes v25). Use `/opt/homebrew/opt/node@22/bin/node` (Node 22 LTS, installed via `brew install node@22`).
- Angular SSR rejects unknown hostnames including `localhost` by default (anti-SSRF defense from CVE-class F1-F5). Set `NG_ALLOWED_HOSTS=localhost` env var when running PoC servers locally, or SSR falls back to CSR and your component does not render server-side.
