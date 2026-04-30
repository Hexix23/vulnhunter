# A18 - TransferCache request-variant confusion

Status: `PROBING`
Phase: Angular Phase 2 expansion.
Seed: A7 `HttpTransferCache` cache-key confusion.

## Hypotheses

### H1 - Cookie-bearing GET is cached by default

`shouldCacheRequest()` only excludes `Authorization` and `Proxy-Authorization` headers when
`includeRequestsWithAuthHeaders` is false. It does not exclude `Cookie`, `X-Tenant`,
`Accept-Language`, or other response-varying request headers.

Expected result:

1. Server-mode GET `/profile` with `Cookie: sid=alice` stores `alice-private`.
2. Browser-mode or later same-render GET `/profile` without that cookie receives `alice-private`.
3. The second request does not hit `HttpTestingController`.

Impact class if confirmed: `SECURITY_LOGIC`, likely bounded until chained to a real SSR app pattern.

### H2 - Tenant/header variants collide on default GET

Two same-URL GETs with different non-auth request headers, for example `X-Tenant: a` vs
`X-Tenant: b`, share the key because `makeCacheKey()` only uses method, responseType, mapped URL,
serialized body, and params.

Expected result: tenant B receives tenant A response from `TransferState`.

Impact class if confirmed: `SECURITY_LOGIC`, stronger for cross-tenant apps that route tenant context
through headers.

### H3 - `httpResource` synchronously trusts the wrong cached variant

`httpResource` calls `retrieveStateFromCache()` during initial stream creation. If H1/H2 collisions
exist, the resource can resolve synchronously with the wrong body before its async request path runs.

Expected result: `res.status()` is `resolved`, `res.value()` equals the first variant body, and no
backend request is observed for the second variant.

## Source Cites

- `packages/common/http/src/transfer_cache.ts:126-143`: cache eligibility only blocks
  `Authorization` and `Proxy-Authorization`.
- `packages/common/http/src/transfer_cache.ts:182-188`: cache lookup before backend request.
- `packages/common/http/src/transfer_cache.ts:315-337`: cache key omits request headers,
  credentials, `withCredentials`, mode, cache, redirect, integrity, and referrer.
- `packages/common/http/src/resource.ts:248-258`: `httpResource` initial stream reads directly from
  `retrieveStateFromCache()`.
- `packages/platform-browser/src/hydration.ts:283-285`: default hydration enables
  `ɵwithHttpTransferCache({})`.

## Initial Verdict Gate

`CONFIRMED_REPORT_CANDIDATE` requires default GET reachability plus a plausible cookie/header tenant
pattern. `CONFIRMED_BOUNDED_PRIMITIVE` is enough to feed later chain work but not enough for VRP
submission.
