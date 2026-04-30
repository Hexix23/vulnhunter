# Walkthrough

## Why this sink

After modern `@angular/ssr` URL validation blocked the tested origin-hijack variants, the next default SSR surface was `HttpTransferCache`.

This is relevant to modern Angular because `provideClientHydration()` wires `ɵwithHttpTransferCache({})` by default, and the Angular SSR guide documents default caching of GET and HEAD requests without auth headers.

## Invariant

Different HTTP requests must not resolve to the same `TransferState` key unless Angular can prove they are semantically identical.

## Code path

`makeCacheKey()` builds:

```ts
const encodedParams = sortAndConcatParams(params);
const key = [method, responseType, mappedRequestUrl, serializedBody, encodedParams].join('|');
const hash = generateHash(key);
```

Two weaknesses were tested:

1. raw `|` separators are not escaped before joining fields;
2. `params.getAll(k)` is interpolated directly, so an array of values is coerced with commas.

## Confirmed

- URL/body field-boundary confusion for opt-in POST transfer caching.
- GET query multiplicity confusion for default TransferCache behavior.
- Browser hydration receives the wrong cached body and does not hit the backend.

## Refuted

- `URLSearchParams` body multiplicity did not collide through the real `HttpRequest.serializeBody()` path.

## Remaining chain work

The framework primitive is real, but final severity needs an app-level chain:

- identify common Angular/SSR apps or libraries that use repeated query params for access-controlled data selection;
- test GraphQL-style `includePostRequests` configurations;
- check whether auth-header exclusion meaningfully limits sensitive data exposure, or whether cookies/session-bound same-origin SSR requests remain enough for impact;
- produce a standalone generated Angular SSR app PoC after this unit-level confirmation.

An attempt was made against Angular's `integration/platform-server` standalone SSR fixture. The
fixture is suitable because it uses `provideClientHydration()` and real `HttpClient`.

The target fails in the OrbStack linux/arm64 VM before the app runs because `rules_browsers` has no
Chromium condition for that configuration. Re-running the same target on macOS arm64 succeeds far
enough to build the app, start the SSR server on port 4206, and run Chrome/Protractor. That app-level
run confirmed that two distinct server HTTP responses can collide in `TransferState`, and that the
hydrated browser reads the overwritten response without issuing a browser `/api` request.
