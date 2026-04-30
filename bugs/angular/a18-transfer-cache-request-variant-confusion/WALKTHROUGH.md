# A18 Walkthrough

Phase 2 started by expanding the A7 cache-key primitive from separator collisions into broader
request-variant dimensions.

The key observation was that Angular's own SSR guide and implementation define default cache
eligibility as GET/HEAD requests that do not contain `Authorization` or `Proxy-Authorization`.
That leaves cookie-authenticated and header-variant requests eligible for default caching.

The source path is:

```text
HttpClient request
  -> transferCacheInterceptorFn()
  -> retrieveStateFromCache()
  -> shouldCacheRequest()
  -> makeCacheKey(method, responseType, mappedUrl, body, params)
  -> TransferState get/set
```

`makeCacheKey()` omits request headers and credentials flags. Therefore same-URL GETs that differ
only by `Cookie`, `X-Tenant`, locale, or API-version headers collapse onto the same state key.

The probe used Angular's existing `TransferCache` test harness rather than a toy app. The temporary
tests confirmed that a cookie-bearing server response and a tenant-header response are replayed to
same-URL requests whose security-relevant request variants differ. The browser hydration variant also
confirmed that the wrong response crosses the server-to-browser `TransferState` boundary.

The second probe moved outside the unit harness into a standalone SSR app using Angular 19.2.21,
`renderApplication()`, `provideServerRendering()`, `provideClientHydration()`, and
`provideHttpClient(withFetch())`. That app forwards inbound cookies with a normal functional
interceptor and makes two sequential same-URL requests with different tenant headers. The rendered
HTML showed `tenant:tenant-a|tenant:tenant-a`, and the backend log showed `/api/hits` was hit only
once. The backend responses explicitly used `Vary: Cookie` and `Vary: X-Tenant`.

The third probe checked whether transferring `Vary` changes behavior. It does not: with
`transferCache: {includeHeaders: ['Vary']}`, the client receives `Vary: X-Tenant` on the replayed
response, but Angular still serves tenant A's cached body to tenant B.

The fourth probe expanded from same-URL variants to distinct-URL collisions. Angular reduces the
full transfer-cache key to a 32-bit state key, so two unrelated URLs can share the same
`TransferState` entry. A chosen collision was found for `/poison?x=yazbadgl` against `/api/profile`;
the app received `ATTACKER_CONTROLLED_BODY` as the `/api/profile` response while the profile backend
was not called.

The fifth probe converted the distinct-URL collision into a security decision. The chosen feed URL
`/feed?x=uibaalzu` collides with fixed `/api/me` for JSON requests. In the SSR app, `/api/me` would
return `{role: "user"}` for `Cookie: sid=alice`, while `/feed` returns an attacker-controlled
`{role: "admin"}` object. Angular served the feed body as the `/api/me` response, the component
rendered `ADMIN_PANEL_SECRET`, and backend hit counts showed `/api/me` was never requested.

The sixth probe tested the cross-user confidentiality chain. A separate SSR origin fetched
`/api/private` with the inbound cookie; the API response returned `Vary: Cookie` and
`Cache-Control: private, no-store`. Angular still serialized `private:sid=alice` into the HTML and
`ng-state`. A local shared cache keyed only by URL then served Alice's cached SSR document to a Bob
request, proving the high-impact deployment chain when SSR HTML is cached across users.

The finding is now reportable as a cache-key / `Vary` / `Cache-Control` semantics issue with a
validated authorization-decision poisoning primitive and a locally reproduced shared-cache
confidentiality chain. Severity should be framed as medium for the framework primitive alone and high
only when chained to real sensitive SSR content, backend action authorization driven by poisoned
data, or cross-user delivery through shared HTML caching.
