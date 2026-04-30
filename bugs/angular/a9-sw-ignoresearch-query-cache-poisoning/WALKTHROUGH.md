# Walkthrough

## Hypothesis

Service Worker asset matching and cache lookup use different URL equivalence classes:

- `Adapter.normalizeUrl()` returns only `pathname` for same-origin URLs.
- Asset `handleFetch()` uses the normalized value to decide whether a request belongs to an asset group.
- Cache lookup/put uses the original `Request` and developer-provided `cacheQueryOptions`.

This makes query strings disappear during routing but reappear during Cache API matching/storage.

## Confirmed behavior

With a manifest pattern for `/runtime-config.json` and `cacheQueryOptions.ignoreSearch: true`:

1. `/runtime-config.json?attacker` is treated as matching `/runtime-config.json`.
2. Angular fetches and stores the response under the original query URL.
3. A later `/runtime-config.json` request matches the cached query URL because `ignoreSearch` is active.
4. The browser receives `attacker-config`; the origin server is not asked for `/runtime-config.json`.

The browser probe used Angular's built `ngsw-worker.js`, not a reimplementation.

## Protective paths

Hashed asset files are protected:

- The same query-stripping also maps `/main.js?x` to `/main.js`.
- But if `/main.js` is in `hashTable`, Angular hashes the fetched response and rejects mismatches.

So the meaningful surface is unhashed asset-group resources, especially same-origin runtime config/static JSON endpoints configured with `ignoreSearch`.

## Security interpretation

This is not HTTP request smuggling and not XSS/RCE. It is a cache-key confusion/integrity primitive.

The default Angular static asset flow is not obviously vulnerable because generated `resources.files` entries are hashed. The bug becomes interesting when an app uses Service Worker asset groups for dynamic or user-varying resources and enables `ignoreSearch`.
