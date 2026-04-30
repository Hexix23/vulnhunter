# Angular Phase 2 Expansion Matrix

Date: 2026-04-29
Target: `targets/angular`
Phase: Expansion after CVE-derived Phase 1 closeout.

## Operating Rule

Phase 2 is not a generic audit. Each branch must start from an entry point, trust boundary,
high-risk operation, attacker model, and concrete sink. Phase 1 primitives are seeds, not anchors.

## Attacker Models

| ID | Model | Meaning |
|---|---|---|
| `AM1` | Remote unauthenticated web user | Controls URL, query, Host, headers accepted by the SSR edge, and route state. |
| `AM2` | Remote authenticated low-privileged user | Controls own cookies/session, route state, profile/content fields, and API parameters. |
| `AM3` | Cross-tenant user | Controls tenant-specific URLs, headers, locale, cache keys, or data that can collide with another tenant/user. |
| `AM4` | Malicious package/library author | Ships Angular directives/components/providers consumed by a victim app. |
| `AM5` | Malicious translator/content/config author | Controls i18n messages, app config, service-worker config, or runtime metadata without arbitrary JS. |

## Phase 2 Priority Surfaces

| Candidate | Surface | Entry point | Trust boundary | High-risk operation | Primary attacker model | Seed | Status |
|---|---|---|---|---|---|---|---|
| `A18` | SSR `HttpTransferCache` request variant confusion | `HttpClient` / `httpResource` during SSR and hydration | Server HTTP response state -> serialized `TransferState` -> browser `HttpClient` | Cache keying and trusted response replay | `AM2`, `AM3` | A7 | `confirmed report candidate` |
| `A19` | Angular Service Worker runtime cache matching | `ngsw.json` `assetGroups` / `dataGroups`, fetch events | Network response -> SW cache -> future navigations/resources | Cache keying, hash validation, `ignoreSearch`, freshness/staleness | `AM1`, `AM5` | A9 | `queued` |
| `A20` | Generic host-binding sanitizer dispatch | Directive/component host bindings on URL-bearing elements | Library/app template metadata -> runtime DOM property/attribute sink | Case normalization, schema matching, ResourceURL vs URL downgrade | `AM4`, `AM5` | A3 | `queued` |
| `A21` | Hydration/event replay integrity | SSR DOM annotations, event replay data, incremental hydration metadata | Server DOM/TransferState -> client reconciliation and deferred event dispatch | Deserialization and trusted DOM state replay | `AM1`, `AM2` | A13/A14 | `queued` |
| `A22` | Router URL and SSR origin interactions | Route recognition, redirects, location strategy, server URL | Inbound request URL -> router state -> navigation/redirect/link generation | URL parsing/canonicalization and trusted navigation state | `AM1` | A1/A8 | `queued` |
| `A23` | Resource loading and compiler/runtime resource URLs | Component style/template URLs, defer blocks, resource loader | Build/runtime metadata -> URL fetch or DOM resource sink | Templating, resource URL classification, SSR/browser mismatch | `AM4`, `AM5` | A4/A15/A16 | `queued` |
| `A24` | XSRF/base-href/browser resolution mismatch chains | Relative mutating `HttpClient` requests and `<base href>` | Angular request-origin decision -> browser fetch URL resolution | Origin validation and credential/header attachment | `AM1`, `AM5` | A8/A12 | `queued` |
| `A25` | Image/resource helper URL surfaces | `NgOptimizedImage`, image loaders, preconnect/preload hints | App data/config -> generated resource URLs and headers | URL generation, preload/preconnect, SSR hints | `AM2`, `AM5` | A10/A16 | `queued` |

## A18 Pre-Probe Card

Target: Angular `HttpTransferCache` and `httpResource`.

Phase: Expansion.

Prior CVE class: not CVE-derived; expands Phase 1 primitive `A7`.

Invariant: two HTTP requests that can receive security-distinct responses must not share a
`TransferState` cache key.

Entry point: SSR `HttpClient` GET/HEAD default transfer cache and `httpResource` initial cache read.

Trust boundary: server-side backend response is serialized into HTML `TransferState` and then trusted
by browser-side `HttpClient`/`httpResource` without revalidating request headers or credentials.

High-risk operation: cache key generation in `makeCacheKey()` and cache replay in
`retrieveStateFromCache()`.

Attacker model: authenticated or cross-tenant user can influence request parameters, non-Authorization
headers, cookies/credentials mode, locale, tenant, or API version used by an SSR-rendered page.

Sink: cached `HttpResponse` body and selected headers returned to a semantically different browser
request without a network request.

Attacker-controlled value: request headers (`Cookie`, `X-Tenant`, `Accept-Language`, API-version
headers), credentials flags, query representation, request body for opted-in POST, and route-driven
`httpResource` request options.

Expected violation:

- default cache stores a GET containing a `Cookie` or other response-varying header;
- second same-URL GET with a different/missing header receives the cached response;
- `httpResource` can synchronously resolve from the wrong cached response using the same key.

Canonical runtime:

- first filter: Angular-owned `packages/common/http/test:test` with the real interceptor, `TransferState`,
  `HttpClientTestingBackend`, server/browser platform IDs, and `ngServerMode` toggles;
- escalation: canonical Angular SSR app only if the default GET/header variant gives reportable impact.

Oracle:

- `HttpTestingController.expectNone()` for the second security-distinct request;
- response body equals the first response;
- source cite showing the header/credentials dimension is omitted from `makeCacheKey()`.

Reportability bar:

- default GET/HEAD behavior, no deliberately vulnerable custom cache;
- header/cookie/tenant/locale dimension is a common security boundary;
- feasible app pattern where the wrong cached response changes authorization, user data, or tenant data.

Stop condition:

- if Angular blocks caching for all credential-bearing/header-varying requests before `makeCacheKey()`;
- if the variant only works with explicit dangerous options and no realistic app chain.

## Queue Discipline

Finish A18 before expanding A19/A20. If A18 only produces bounded primitives, catalog them and keep
the Phase 2 matrix moving; do not spend the whole phase on cache-key variants.

## Learned During A18

`HttpTransferCache` default GET/HEAD eligibility excludes `Authorization` and `Proxy-Authorization`
but not `Cookie` or other response-varying headers. The cache key also omits request headers and
credentials flags. This gives a confirmed framework primitive for wrong-response replay across:

- cookie-bearing GET -> same-URL GET without cookie;
- `X-Tenant` variant A -> same-URL `X-Tenant` variant B;
- server-side cached response -> browser hydration cache hit.

Canonical SSR reachability has been validated in
`bugs/angular/a18-transfer-cache-request-variant-confusion/poc/ssr-cookie-app/server.ts`: Angular
19.2.21 with `renderApplication()`, `provideServerRendering()`, `provideClientHydration()`, and
`provideHttpClient(withFetch())` replays a tenant A response into a tenant B same-URL request. The
backend returns `Vary: X-Tenant`, and Angular still replays tenant A. A separate unit probe confirms
that even transferring `Vary` via `includeHeaders: ['Vary']` does not make Angular honor it.
Further probes confirmed that `Cache-Control: private, no-store` is ignored and that distinct URLs
can collide because Angular stores the transfer-cache entry under a 32-bit hash rather than a
collision-resistant key.
The highest-impact A18 subcase is now chosen-target poisoning: `/poison?x=yazbadgl` was generated to
collide with `/api/profile`; Angular returned `ATTACKER_CONTROLLED_BODY` as the `/api/profile`
response in a canonical SSR app, with backend profile hit count 0.

The chain has also been escalated to SSR authorization-decision poisoning. `/feed?x=uibaalzu` was
generated to collide with fixed `/api/me` for JSON transfer-cache keys. In the canonical SSR app,
`/api/me` would return `{role: "user"}` for `Cookie: sid=alice`, but Angular served the
attacker-controlled feed body `{role: "admin"}` as the `/api/me` result. The component rendered
`ADMIN_PANEL_SECRET`, and backend hit counts showed `/api/me` was not called.

A separate cross-user chain has been locally reproduced. An Angular SSR origin fetched a private API
response using the inbound cookie; that API returned `Vary: Cookie` and
`Cache-Control: private, no-store`. Angular serialized `private:sid=alice` into HTML/`ng-state`, and
a shared URL-keyed cache served that cached HTML to a Bob request. This validates the conditional
high-impact path when SSR HTML is cached across users.

Current status is VRP report candidate with medium framing and a conditional high path. The remaining
gap for high severity is proving these chains in a realistic deployed Angular SSR configuration or
documenting the shared-cache assumptions tightly enough for VRP acceptance.
