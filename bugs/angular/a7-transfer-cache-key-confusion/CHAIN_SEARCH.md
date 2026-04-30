# A7 chain search notes

Date: 2026-04-28

## What to search for

Priority patterns:

```ts
provideClientHydration()
provideClientHydration(withHttpTransferCacheOptions(...))
withHttpTransferCacheOptions({includePostRequests: true})
http.get('/api/...', {params: {tag: ['a', 'b']}})
http.get('/api/...', {params: new HttpParams({fromObject: {tag: ['a', 'b']}})})
params.appendAll({tag: ['a', 'b']})
transferCache: true
transferCache: {includeHeaders: ...}
```

Interesting parameter names for real impact:

```text
id, ids, user, users, role, roles, tenant, tenants, org, orgs, project, projects,
scope, scopes, permission, permissions, group, groups, account, accounts,
include, fields, filter, filters, tag, tags, category, categories, status, sort,
where, search, q, query
```

Collision families:

```text
GET /api?ids=1,2
GET /api?ids=1&ids=2

GET /api?roles=user,admin
GET /api?roles=user&roles=admin

GET /api?tenant=a,b
GET /api?tenant=a&tenant=b
```

POST opt-in collision:

```text
POST /api|x body y
POST /api body x|y
```

## Local Angular signals

Angular's own tests establish that array params are normal supported `HttpClient` behavior:

- `packages/common/http/test/client_spec.ts:66-88`
  - `params: {'test': ['a', 'b']}` serializes to `/test?test=a&test=b`.
  - number, boolean, and mixed arrays are also supported.
- `packages/common/http/test/params_spec.ts:75-96`
  - `appendAll({a: ['a2', 'a3']})` serializes repeated keys.
- `packages/common/http/test/params_spec.ts:190-220`
  - `new HttpParams({fromObject: {b: ['21', '22']}})` serializes repeated keys.

The Angular SSR guide establishes the relevant TransferCache defaults:

- `HttpClient` caches server-side GET/HEAD requests by default during SSR/hydration.
- POST transfer caching is documented for read-style APIs such as GraphQL.
- docs explicitly mention excluding user-specific or dynamic endpoints such as `/api/profile` and `/api/sensitive-data`.

## External signals

Public Angular issues/discussions show developers care about this exact boundary:

- angular/angular#50117: requested TransferCache customization for GraphQL, batching, internal APIs, device-specific responses, and custom cache behavior.
- angular/angular#53702: requested custom cache keys and notes that advanced users want to override `makeCacheKey`.
- angular/angular#54745 and StackOverflow 78499930: developers observed sensitive/authenticated GET caching concerns and recommended filters or auth-header exclusions.

## Current status

No high-impact public app chain has been confirmed yet.

The best next chain path is not generic "find any repeated params"; it is:

1. Angular SSR app uses `provideClientHydration()` and does not disable TransferCache.
2. It makes two same-render `HttpClient` GET calls with repeated-vs-comma query semantics.
3. The backend treats repeated params differently from comma-containing single params.
4. One response influences authorization, tenant/resource selection, profile data, permissions, or UI actions.
5. Hydration consumes the wrong response from `TransferState` without browser network traffic.

