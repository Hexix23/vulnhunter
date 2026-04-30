# A18 - Angular TransferCache request-variant confusion

Status: `CONFIRMED_REPORT_CANDIDATE`
Impact class: `SECURITY_LOGIC`
Phase: Phase 2 expansion.

## Summary

Angular `HttpTransferCache` caches default GET/HEAD requests unless they contain `Authorization` or
`Proxy-Authorization`. The cache key does not include request headers, cookie state, credentials
mode, or response `Vary` dimensions.

Runtime tests against Angular's own `packages/common/http/test:test` target confirmed that:

- a GET carrying `Cookie: sid=alice` is cached by default;
- a later same-URL GET without that cookie is served the cookie-bearing response from
  `TransferState`;
- two same-URL GETs that differ only by `X-Tenant` header collide;
- the same cookie-bearing server response is replayed during browser hydration without a backend
  request.

A standalone SSR app using Angular 19.2.21, `renderApplication()`, `provideServerRendering()`,
`provideClientHydration()`, and `provideHttpClient(withFetch())` confirmed the primitive outside the
unit harness. Two sequential same-URL requests with `X-Tenant: tenant-a` and `X-Tenant: tenant-b`
produced `tenant:tenant-a|tenant:tenant-a` in rendered HTML, and the backend was hit once. The
backend response explicitly sent `Vary: X-Tenant`.

An additional Angular-owned unit probe confirmed that even when `Vary` is transferred with
`transferCache: {includeHeaders: ['Vary']}`, Angular returns the cached tenant A body to a tenant B
request. The client can see `Vary: X-Tenant`, but the transfer cache did not honor it.

Another probe confirmed that Angular also caches and replays responses marked
`Cache-Control: private, no-store`. Even when `Cache-Control` is transferred with
`transferCache: {includeHeaders: ['Cache-Control']}`, Angular serves the cached body while exposing
the `private, no-store` header on the replayed response.

A further probe confirmed that `makeCacheKey()` compresses the full cache key into a 32-bit hash and
does not handle collisions. Two distinct URLs with the same generated hash share a `TransferState`
entry. The second URL is served the first URL's response without a backend request. This was
confirmed both in Angular's `packages/common/http/test:test` target and in the standalone SSR app.

The strongest current chain is a chosen-target collision: an attacker-controlled URL
`/poison?x=yazbadgl` was generated to collide with the fixed sensitive URL `/api/profile` in the
canonical SSR app. Angular served `ATTACKER_CONTROLLED_BODY` as the `/api/profile` response, and
`/api/profile` was never requested from the backend.

The chain was then extended to an authorization-decision PoC. An attacker-influenced feed URL
`/feed?x=uibaalzu` was generated to collide with the fixed `/api/me` URL for default JSON requests.
In the canonical SSR app, `/api/me` would return `{role: "user"}` for the victim cookie, but Angular
served the feed response `{role: "admin"}` as the `/api/me` result. The SSR component rendered
`ADMIN_PANEL_SECRET`, and backend hit counts showed `/api/me` was never called.

A separate shared-cache PoC validated the conditional high-impact confidentiality chain. Angular SSR
serialized an API response marked `Vary: Cookie` and `Cache-Control: private, no-store` into HTML
and `ng-state`. A local shared cache keyed only by URL then served Alice's SSR HTML, including
`private:sid=alice`, to Bob.

Independent verification confirmed the same source-level conclusions and reproduced the runtime
behavior. The verifier also built a fresh Angular SSR app without chosen-collision suffixes and
confirmed the base `Vary: X-Tenant` request-variant confusion in a normal SSR route:
`tenant:tenant-a|tenant:tenant-a` with only one backend hit.

A deeper sink review found an additional deterministic pre-hash collision in request params.
`sortAndConcatParams()` stringifies `params.getAll(k)` directly, so repeated values and a
comma-containing scalar collapse to the same key material. Runtime PoC:
`role=user&role=admin` and `role=user,admin` both key as `role=user,admin`; Angular replayed the
first response to the second request without a backend hit.

The same param serialization also allows separator collisions with `&`. A single encoded value
`a=1%26b=2` and two split params `a=1&b=2` both key as `a=1&b=2`, so Angular replays the
single-value response to the split-param request without a backend hit.

Evidence:

- `bugs/angular/a18-transfer-cache-request-variant-confusion/evidence/2026-04-29-angular-transfer-cache-header-probe.md`
- `bugs/angular/a18-transfer-cache-request-variant-confusion/evidence/2026-04-29-angular-transfer-cache-authz-chain.md`
- `bugs/angular/a18-transfer-cache-request-variant-confusion/evidence/2026-04-29-angular-transfer-cache-shared-html-cache-chain.md`
- `bugs/angular/a18-transfer-cache-request-variant-confusion/evidence/2026-04-29-independent-verification.md`
- `bugs/angular/a18-transfer-cache-request-variant-confusion/evidence/2026-04-30-deterministic-http-params-collision.md`
- `bugs/angular/a18-transfer-cache-request-variant-confusion/evidence/2026-04-30-deterministic-param-separator-collision.md`
- `bugs/angular/a18-transfer-cache-request-variant-confusion/poc/transfer_cache_header_probe.ts`
- `bugs/angular/a18-transfer-cache-request-variant-confusion/poc/ssr-cookie-app/server.ts`
- `bugs/angular/a18-transfer-cache-request-variant-confusion/poc/ssr-cookie-app/shared_cache_private_state_server.ts`
- `bugs/angular/a18-transfer-cache-request-variant-confusion/poc/ssr-cookie-app/deterministic_params_collision_server.ts`
- `bugs/angular/a18-transfer-cache-request-variant-confusion/poc/ssr-cookie-app/params_separator_collision_server.ts`

## Violated Invariant

Two HTTP requests that can receive security-distinct responses must not share a `TransferState`
cache key.

The invariant is broken because:

- eligibility only treats `Authorization` and `Proxy-Authorization` as auth-sensitive;
- request headers such as `Cookie`, `X-Tenant`, `Accept-Language`, API-version headers, and
  credentials flags can influence backend responses;
- none of those dimensions are included in `makeCacheKey()`.

## Relevant Source

- `packages/common/http/src/transfer_cache.ts:126-143` - `shouldCacheRequest()` blocks auth headers
  but not cookie or other response-varying headers.
- `packages/common/http/src/transfer_cache.ts:182-188` - cache lookup occurs before backend dispatch.
- `packages/common/http/src/transfer_cache.ts:322-337` - `makeCacheKey()` omits headers and
  credentials flags.
- `packages/common/http/src/transfer_cache.ts:337-340` - the complete key is reduced to a 32-bit hash
  string before `makeStateKey()`.
- `packages/common/http/src/resource.ts:248-258` - `httpResource` reuses the same cache lookup for
  initial synchronous resolution.
- `packages/platform-browser/src/hydration.ts:283-285` - default hydration wires
  `ɵwithHttpTransferCache({})`.
- `adev/src/content/guide/ssr.md:428-435` - docs describe default GET/HEAD transfer caching, excluding
  only `Authorization` and `Proxy-Authorization`.

## Impact Assessment

Confirmed impact today: wrong-response replay across SSR/hydration for semantically distinct
requests in the same render/hydration boundary.

Security relevance:

- Cookie-authenticated SSR apps commonly forward user cookies to backend APIs through server-side
  interceptors.
- Multi-tenant apps often use tenant, locale, feature, or API-version headers to select data.
- A cached response can be consumed by browser `HttpClient`/`httpResource` without a network request,
  so client code observes a trusted response for the wrong request variant.
- Backend `Vary` is the standard signal that a response varies by request header. Angular's transfer
  cache can ignore that signal, including when `Vary` is explicitly transferred.
- Backend `Cache-Control: private, no-store` is the standard signal that a response should not be
  stored. Angular still serializes the body into SSR HTML `TransferState`.
- Distinct URLs can be made to collide on Angular's 32-bit transfer-cache hash, allowing wrong-body
  replay even when request URLs differ.
- A chosen attacker URL can be generated to collide with a fixed victim URL, allowing attacker body
  replay into a sensitive `HttpClient` consumer.
- A chosen attacker URL can poison a trusted `/api/me` consumer during SSR. The PoC renders
  admin-gated content from an attacker-controlled JSON body while the real `/api/me` endpoint is not
  contacted.
- Deterministic pre-hash param collisions can replay responses across repeated-param and
  comma-scalar request variants without needing to brute-force the 32-bit hash.
- Deterministic separator collisions can replay responses across encoded-single-value and split-param
  variants, also without brute-forcing the 32-bit hash.
- A shared HTML cache can deliver one user's serialized private API response to another user when
  the page HTML is cached by URL, because Angular has copied the `private, no-store` API body into
  the HTML document.

Limits:

- Cross-user leakage requires the surrounding app or CDN to cache/reuse SSR HTML across users. A
  local proxy PoC validates that chain, but it is still deployment-dependent.
- This is not backend authorization bypass by itself; it is SSR/client authorization-decision
  poisoning when the application gates rendered data or UI on a transfer-cached `HttpClient`
  response.
- Angular docs recommend filtering sensitive endpoints, so there is a mitigation path.
- A canonical SSR app with cookie forwarding and a poisoned `/api/me` authorization decision is
  validated. The remaining gap for high severity is cross-user confidentiality or privilege impact
  in a real deployment, such as shared caching of SSR HTML, or a natural app flow where
  attacker-controlled SSR data precedes victim-trusted authorization/data requests.

## Reportability

Current classification: stronger report candidate. Medium is appropriate for the framework primitive
alone. High is defensible when the report includes either:

- SSR-rendered sensitive authorization/data impact from the poisoned `/api/me` style chain; or
- cross-user delivery of serialized private API responses through shared SSR HTML caching.

This should be framed as a cache semantics vulnerability in Angular's SSR `HttpTransferCache`, not
as HTTP request smuggling. The reportable claim is:

```text
Angular SSR HttpTransferCache caches GET/HEAD responses by default using a key that omits request
headers and credentials, and it ignores backend Vary and Cache-Control: no-store/private. This allows
wrong-response replay across cookie-, tenant-, locale-, or API-version-varied requests during SSR and
hydration, can serialize private/no-store API responses into cacheable SSR HTML, and uses a
collision-prone 32-bit hash as the final TransferState key. A chosen attacker-controlled URL can
collide with a fixed sensitive URL such as /api/me, causing SSR authorization decisions to consume an
attacker-controlled JSON response.
```

Remaining limitation: the strongest confidentiality impact still depends on an application making
security-relevant same-URL requests that vary by headers/cookies. The framework behavior and canonical
SSR reachability are confirmed.

## Next Probe

Prepare a VRP-style report with low/medium severity language, then continue searching for a stronger
chain:

- shared CDN/proxy caching SSR HTML containing poisoned `TransferState`;
- private/no-store backend data embedded into publicly cacheable SSR HTML;
- common Angular SSR cookie-forwarding helpers;
- locale or API-version endpoints using `Vary: Accept-Language` or custom version headers;
- `httpResource` synchronous wrong-value use in authz or tenant UI decisions.
- real-world Angular SSR examples where attacker-influenced feed/search/cms URLs are fetched before
  `/api/me`, `/api/profile`, feature flags, entitlements, or tenant bootstrap endpoints.
