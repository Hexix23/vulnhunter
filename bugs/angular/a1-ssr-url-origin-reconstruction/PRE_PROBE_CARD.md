# Pre-Probe Card: A1 SSR URL Origin Reconstruction

Target: Angular framework `@angular/platform-server`

Phase: CVE-derived

Impact class: `SECURITY_LOGIC`

Prior CVE class: CWE-918 SSRF / origin confusion

Advisory/fix source:

- GHSA-45q2-gjvg-7973 / CVE-2026-41423
- Fix commits observed locally:
  - `303d4cd580` `fix(platform-server): prevent SSRF bypasses via protocol-relative and backslash URLs`
  - `be1f80a253` `fix(platform-server): ensure origin has a trailing slash when parsing url`

Fix diff files:

- `packages/platform-server/src/location.ts`
- `packages/platform-server/test/platform_location_spec.ts`

Invariant:

- A server request target that is intended to represent the current request path must not become a different absolute origin inside `ServerPlatformLocation`.
- `ServerPlatformLocation` origin must stay bound to the trusted document/server origin when SSR receives path-like request input.

Entry point:

- `INITIAL_CONFIG.url` passed into `platformServer()`, `renderModule()`, `renderApplication()`, or direct/legacy `CommonEngine` usage.

Trust boundary:

- Remote HTTP request target / Host-derived URL material -> Angular SSR platform location -> server-side `HttpClient` URL rewrite.

High-risk operation:

- URL canonicalization with WHATWG `URL`.
- Server-side relative HTTP request rewriting.

Attacker model:

- Remote unauthenticated attacker can send crafted HTTP request targets to an SSR server.
- The SSR app uses affected direct/legacy APIs and passes raw `req.url` or raw Host-derived URL material into Angular rendering.
- The rendered app performs relative server-side `HttpClient` requests or uses `PlatformLocation.hostname`.

Sink:

- `packages/platform-server/src/location.ts:27-37` `parseUrl(urlStr, origin)`.
- `packages/platform-server/src/location.ts:60-71` `INITIAL_CONFIG.url` -> `ServerPlatformLocation`.
- `packages/platform-server/src/http.ts:48-63` relative server `HttpClient` rewrite.

Attacker-controlled value:

- `req.url` / request target, especially malformed absolute-form values such as `http:///attacker.test/path`.
- In direct legacy patterns, raw `headers.host` concatenated into render URL.

Expected violation:

- `parseUrl('http:///attacker.test/path', 'http://victim.test')` returns effective origin `http://attacker.test`.
- Relative server-side `HttpClient.get('/internal')` rewrites to `http://attacker.test/internal`.

Canonical runtime:

- Angular-owned `//packages/platform-server/test:test` for framework reachability.
- A direct/legacy Angular SSR app for reportability validation.
- Current default `@angular/ssr` Node engine must be tested separately and currently appears protected for tested variants.

Oracle:

- Framework oracle: `ServerPlatformLocation.hostname` becomes attacker-controlled and `HttpClientTestingBackend` observes request URL under attacker host.
- App oracle: attacker listener receives the SSR server's outgoing relative request.

Reportability bar:

- `CONFIRMED_REPORT_CANDIDATE` if a realistic direct/legacy Angular SSR app can be made to issue an outbound request to attacker-controlled origin from one remote request.
- `CONFIRMED_BOUNDED_PRIMITIVE` if limited to direct `platform-server` API misuse or legacy patterns with no common/default reachability.
- `REFUTED_UNREACHABLE_IN_REALISTIC_APP` for current default `@angular/ssr` if request construction and host validation always neutralize the value before Angular rendering.

Stop condition:

- Stop direct/legacy branch after a full SSR app either sends the outbound request to the attacker listener or proves the malformed request target cannot reach `INITIAL_CONFIG.url` in realistic wiring.
- Stop modern SSR branch after three independent variants close on `createRequestUrl()` / host validation.
