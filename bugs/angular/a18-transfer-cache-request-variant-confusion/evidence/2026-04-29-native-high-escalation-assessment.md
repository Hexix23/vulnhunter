# A18 native high/critical escalation assessment

Date: 2026-04-29

Question: can the A18 primitive produce high/critical impact natively from Angular SSR alone, without
an outer shared HTML cache or an application-specific sensitive decision chain?

## Result

Current verdict: no native high/critical chain confirmed.

What is confirmed natively:

- Angular default `provideClientHydration()` enables `HttpTransferCache`.
- Same-render security-distinct `HttpClient` requests can receive the wrong cached response.
- Backend `Vary` and `Cache-Control: private/no-store` are ignored by Angular's transfer cache.
- Distinct URLs can collide because the final `StateKey` is a 32-bit hash.
- A chosen collision can poison a trusted same-render consumer such as `/api/me`.

What is not confirmed natively:

- no direct cross-render `TransferState` reuse was observed;
- no cross-user leak was observed when requests go directly to the Angular SSR origin;
- no Angular-owned shared HTML cache was found in the inspected source path;
- no direct backend authorization bypass was demonstrated.

## Source boundary check

`renderApplication()` creates a server platform per render and destroys it in `finally`:

```text
targets/angular/packages/platform-server/src/utils.ts:323-352
```

Relevant behavior:

```text
const platformRef = createServerPlatform(options);
try {
  const applicationRef = await bootstrap({platformRef});
  await applicationRef.whenStable();
  const rendered = await renderInternal(platformRef, applicationRef);
  return rendered;
} finally {
  await asyncDestroyPlatform(platformRef);
}
```

`TransferState` is provided in the root injector, so with a per-render platform it is request-local
for normal `renderApplication()` SSR:

```text
targets/angular/packages/core/src/transfer_state.ts:66-82
```

This supports the observed behavior that separate renders do not naturally share `TransferState`.

## Direct-origin runtime check

PoC server:

```text
bugs/angular/a18-transfer-cache-request-variant-confusion/poc/ssr-cookie-app/shared_cache_private_state_server.ts
```

Command:

```bash
cd bugs/angular/a18-transfer-cache-request-variant-confusion/poc/ssr-cookie-app
./node_modules/.bin/tsx shared_cache_private_state_server.ts
```

Direct origin requests, bypassing the shared proxy:

```bash
curl -sS -i -H 'Cookie: sid=alice' 'http://127.0.0.1:4220/private?case=native-direct'
curl -sS -i -H 'Cookie: sid=bob' 'http://127.0.0.1:4220/private?case=native-direct'
curl -sS -i -H 'Cookie: sid=carol' 'http://127.0.0.1:4220/private?case=native-seq2'
curl -sS -i -H 'Cookie: sid=dave' 'http://127.0.0.1:4220/private?case=native-seq3'
```

Observed direct-origin responses:

```html
<div id="private">private:sid=alice</div>
```

```html
<div id="private">private:sid=bob</div>
```

```html
<div id="private">private:sid=carol</div>
<script id="ng-state" type="application/json">{"3517752801":{"b":"private:sid=carol", ...}}</script>
```

```html
<div id="private">private:sid=dave</div>
<script id="ng-state" type="application/json">{"3517752801":{"b":"private:sid=dave", ...}}</script>
```

Observed origin log:

```text
[origin:api] /api/private hit 1 cookie= "sid=alice"
[origin:ssr] private body: private:sid=alice
[origin:api] /api/private hit 2 cookie= "sid=bob"
[origin:ssr] private body: private:sid=bob
[origin:api] /api/private hit 3 cookie= "sid=dave"
[origin:ssr] private body: private:sid=dave
[origin:api] /api/private hit 4 cookie= "sid=carol"
[origin:ssr] private body: private:sid=carol
```

No Alice-to-Bob or Carol-to-Dave transfer-state reuse was observed at the direct Angular SSR origin.

## High/critical escalation conditions that remain plausible

The primitive can still reach high-impact outcomes when chained with normal application/deployment
patterns:

1. Same-render sensitive decision:
   - attacker controls part of an SSR-fetched URL;
   - the same render fetches `/api/me`, entitlements, tenant bootstrap, feature flags, or other
     trusted authorization/data bootstrap endpoints;
   - a chosen 32-bit collision causes the trusted consumer to receive attacker-controlled JSON.

2. Shared SSR HTML:
   - Angular serializes private/no-store API data into `ng-state`;
   - an outer cache stores SSR HTML by URL and does not vary on user identity/cookie;
   - another user receives the first user's serialized private state.

3. Real target-specific chain:
   - a real Angular SSR app uses default transfer cache on sensitive endpoints;
   - route-level headers or deployment config make the SSR HTML cacheable;
   - attacker can trigger one user's private state to be served to another user, or can poison a
     victim's same-render bootstrap data.

## Reporting implication

The framework-owned vulnerability should be reported as:

```text
Trusted response replay in Angular SSR HttpTransferCache due to incomplete cache key and 32-bit
StateKey collisions.
```

It should not be claimed as natively cross-user or critical from Angular alone based on current
evidence. The report should emphasize:

- native framework impact: wrong trusted response replay in a normal SSR app;
- demonstrated escalation: `/api/me` poisoning and shared-cache private-state leak;
- exact conditions required for the strongest impact.
