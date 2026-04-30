# A18 Chain Search

Status: in progress.

## Confirmed Escalation

`Vary` is ignored by Angular `HttpTransferCache`.

Evidence:

- unit probe: backend response has `Vary: X-Tenant`; second same-URL request with `X-Tenant: tenant-b`
  is served tenant A's body;
- unit probe: even when `Vary` is included via `transferCache: {includeHeaders: ['Vary']}`, Angular
  transfers the header but still does not honor it;
- SSR app: `/api/hits` returns `Vary: X-Tenant`; rendered HTML shows
  `tenant:tenant-a|tenant:tenant-a`, backend hit count is 1.

`Cache-Control: private, no-store` is also ignored:

- unit probe: response body is cached and replayed when backend sends
  `Cache-Control: private, no-store`;
- unit probe: even when `Cache-Control` is included via `includeHeaders`, Angular transfers the
  header but still replays the cached body;
- SSR app: `/api/profile` and `/api/hits` return `Cache-Control: private, no-store`, and their bodies
  are still serialized into `ng-state`.

The final `TransferState` key is a 32-bit hash and collisions are practical:

- unit probe: `/collision/4du1y3wwrg` and `/collision/xjb04p9--8` collide for
  `GET|text|<url>||`, so the second URL receives the first URL's body;
- SSR app: absolute URLs `/collision/xisvtfhqif` and `/collision/b3g_cxklta` collide for
  `http://127.0.0.1:4218`, and the second URL does not hit the backend.
- SSR app chosen-target: `/poison?x=yazbadgl` collides with fixed `/api/profile`, so Angular returns
  `ATTACKER_CONTROLLED_BODY` for `/api/profile` and the profile backend hit count is 0.
- SSR app chosen-target authz chain: `/feed?x=uibaalzu` collides with fixed `/api/me` for JSON
  requests. The app renders `ADMIN_PANEL_SECRET` because the `/api/me` consumer receives
  `{"user":"attacker","role":"admin","source":"feed"}`. Backend hit counts show `/api/me` was not
  called (`me=0`) while `/feed` was called once.
- Deterministic params chain: `sortAndConcatParams()` uses `${params.getAll(k)}`, so
  `role=user&role=admin` and `role=user,admin` both key as `role=user,admin` before hashing. SSR app
  confirms only the repeated-param backend request is made, while the comma-scalar request receives
  the repeated-param response.
- Deterministic separator chain: the same serialization leaves `&` unescaped in key material, so
  `a=1%26b=2` and `a=1&b=2` both key as `a=1&b=2`. SSR app confirms only the encoded-single-value
  backend request is made, while the split-param request receives that response.
- Shared-cache confidentiality chain: Angular SSR embeds an API response marked `Vary: Cookie` and
  `Cache-Control: private, no-store` into HTML/`ng-state`. A local shared cache keyed only by URL
  serves Alice's cached SSR HTML to Bob, including `private:sid=alice`.

## Reportability Position

Reportable as medium-leaning cache semantics violation, with a stronger application-impact chain:
request-header variants, `Vary`, `Cache-Control: private/no-store`, and distinct-URL 32-bit hash
collisions are ignored by SSR `HttpTransferCache`; a chosen attacker URL can poison a trusted
`/api/me` SSR consumer.

Not an HTTP request smuggling report. Web cache poisoning is a possible deployment chain if SSR HTML
containing poisoned `TransferState` is cached by a CDN/proxy.

High-severity threshold remains conditional but now has local reproduction for both paths:

- SSR authz/content gate poisoning: `/api/me` receives attacker-controlled admin JSON and renders
  `ADMIN_PANEL_SECRET`.
- Cross-user confidentiality chain: shared HTML cache delivers Alice's private `ng-state` to Bob.

The remaining work for a high-confidence VRP submission is real-world plausibility: prove that these
patterns arise from normal Angular SSR deployments or clearly document the deployment assumptions.

## Native High/Critical Check

Native cross-render leakage from Angular SSR alone is not confirmed. `renderApplication()` creates a
server platform per render and destroys it in `finally`; direct-origin tests with separate cookies
returned each user's own private state. This means the current high-impact chains still require
either a same-render sensitive decision path or outer shared HTML caching.

Evidence:

- `bugs/angular/a18-transfer-cache-request-variant-confusion/evidence/2026-04-29-native-high-escalation-assessment.md`

## Stronger Chains To Search

1. Shared cache chain:
   - SSR HTML contains `ng-state` with private/header-varied body.
   - CDN/proxy caches the HTML without varying on `Cookie`, tenant, or locale.
   - Other users receive the poisoned `TransferState`.
   - Stronger when embedded API response explicitly had `Cache-Control: private, no-store`, because
     Angular strips that protection at the API-response boundary.
   - Current PoC confirms this chain locally with a URL-keyed shared cache.

2. Tenant chain:
   - App makes same-URL backend requests varying only by tenant header.
   - Attacker controls or influences one tenant variant.
   - Victim path consumes the wrong cached body in SSR/hydration.

3. Cookie forwarding chain:
   - SSR interceptor forwards inbound `Cookie` to backend API.
   - `provideClientHydration()` default transfer cache stores private API response.
   - Browser/client code or outer cache reuses response outside the original cookie context.

4. Locale/API-version chain:
   - Backend sends `Vary: Accept-Language` or API-version header.
   - Angular ignores `Vary` and replays the wrong localized/versioned body.

5. Hash collision chain:
   - Attacker controls one SSR-fetched URL or query value.
   - Target app fetches a sensitive URL in the same render/hydration boundary.
   - A chosen-prefix/chosen-target collision causes the sensitive request to receive the attacker
   controlled cached body, or causes attacker-controlled content to be replayed into a trusted
   endpoint consumer.
   - Current PoC demonstrates attacker-controlled body replay into `/api/profile`.
- Current PoC also demonstrates `/api/me` authorization-decision poisoning and admin-gated SSR
     content render (`ADMIN_PANEL_SECRET`) from an attacker-controlled feed body.

6. Deterministic request-param collision chain:
   - App uses Angular `HttpParams` with repeated params for one request and a comma-containing scalar
     value for another request.
   - Backend treats repeated query parameters and comma-delimited scalar values differently.
   - Angular collapses both variants before the 32-bit hash, causing wrong-response replay without
     brute-force.
   - Current PoC demonstrates `role=user&role=admin` -> `multi:user|admin` replayed into
     `role=user,admin`, where the backend would have returned `scalar:user,admin`.
   - Current PoC also demonstrates `a=1%26b=2` -> `single:a=1&b=2` replayed into `a=1&b=2`,
     where the backend would have returned `split:a=1|b=2`.

## Local Source Support

- `adev/src/content/guide/ssr.md:428-435`: Angular docs describe default HTTP response caching and
  only exclude `Authorization` / `Proxy-Authorization`.
- `adev/src/content/guide/i18n/deploy.md:17-24`: Angular SSR can use `Accept-Language` for dynamic
  language handling, making locale-varied responses a natural web header boundary.
- `packages/common/http/src/transfer_cache.ts:322-337`: transfer cache key omits headers and `Vary`.
- `packages/common/http/src/transfer_cache.ts:337-340`: full transfer key is reduced to a 32-bit
  hash string.
- `packages/common/http/src/transfer_cache.ts:315-319`: repeated request-param values are coerced
  with `Array.toString()`, causing deterministic pre-hash collisions with comma-containing scalar
  values.
- `packages/platform-browser/src/hydration.ts:283-285`: default hydration wires transfer cache.
