# A7 - Angular HttpTransferCache cache-key confusion

Status: `CONFIRMED-RESPONSE-CONFUSION`

## Summary

Modern Angular SSR enables `HttpTransferCache` by default through `provideClientHydration()`.
The cache key is built by concatenating unescaped fields with `|` and by serializing
multi-value `HttpParams` through array string coercion.

This allows distinct `HttpClient` requests to share the same `TransferState` key and receive
the wrong cached response during SSR and browser hydration.

## Confirmed primitives

### 1. Default GET / HttpParams multiplicity confusion

Two different GET requests collide:

```ts
http.get('/query', {params: new HttpParams({fromObject: {a: '1,2'}})})
// actual request URL: /query?a=1,2

http.get('/query', {params: new HttpParams({fromObject: {a: ['1', '2']}})})
// actual request URL: /query?a=1&a=2
```

Both are keyed as:

```text
GET|json|/query||a=1,2
```

The second request is served from `TransferState` and does not reach the backend.

### 2. POST URL/body separator confusion

Two different POST requests collide when request-level `transferCache: true` is used:

```ts
http.request('POST', '/api|x', {transferCache: true, body: 'y'})
http.request('POST', '/api', {transferCache: true, body: 'x|y'})
```

Both are keyed as:

```text
POST|json|/api|x|y|
```

## Browser hydration impact

Confirmed in Angular's own `packages/common/http/test: test` target:

1. Server-side request `/query?a=1,2` stores `server-response` in `TransferState`.
2. Browser-side hydrated request `/query?a=1&a=2` is resolved from cache.
3. `HttpTestingController.expectNone('/query?a=1&a=2')` passes, proving no network request occurs.
4. The browser receives `server-response`.

## Relevant source

- `packages/platform-browser/src/hydration.ts:283-285` enables `ɵwithHttpTransferCache({})` by default unless disabled or explicitly configured.
- `packages/common/http/src/transfer_cache.ts:124-135` caches GET/HEAD by default and allows POST when opted in.
- `packages/common/http/src/transfer_cache.ts:315-319` serializes params as `` `${k}=${params.getAll(k)}` ``.
- `packages/common/http/src/transfer_cache.ts:337` joins key fields with raw `|`.

## Impact assessment

Current impact: response integrity confusion inside the same SSR render / hydration boundary.

This is not XSS/RCE by itself. It becomes security-relevant when:

- the application has two semantically different GET endpoints distinguished by repeated query parameters vs comma-containing single values;
- the first response contains user-specific or authorization-sensitive data that the second code path should not receive;
- the second code path makes an authorization or UI decision based on the cached body;
- the application enables POST transfer caching for read-style APIs such as GraphQL.

Default Angular behavior matters here: the GET variant does not require `includePostRequests` or request-level `transferCache`; Angular SSR documentation states that GET and HEAD requests are cached by default when hydration is enabled.

Recommended report severity at this stage: likely `Low` to `Medium`, depending on a real app chain. Framework reportability looks plausible because the invariant "different HTTP requests must not share a transfer cache key" is violated in a default SSR feature.

