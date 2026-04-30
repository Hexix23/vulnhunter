# Verdict: CONFIRMED-CHAIN-PRIMITIVE

Angular Service Worker can serve a response fetched for a query-bearing URL to the canonical queryless URL when an asset group is:

- matched through `resources.urls` / manifest `patterns`,
- unhashed (`hashTable` has no entry for that URL),
- configured with `cacheQueryOptions.ignoreSearch: true`.

Confirmed with:

- Angular worker unit probe.
- Real Chrome headless page controlled by the Bazel-built Angular `ngsw-worker.js`.

Impact:

- Response integrity/cache poisoning primitive for apps that cache same-origin dynamic or user-influenced resources as Service Worker assets with `ignoreSearch`.
- The canonical URL can receive a previously cached query-variant body without a second network request.

Limits:

- Not exploitable against default Angular CLI static assets by itself. Hashed files are protected by manifest SHA-1 validation.
- Requires a developer/app configuration where a same-origin unversioned resource is placed in an asset group and `ignoreSearch` is enabled.
- Requires the attacker to cause the victim/browser to request a variant URL whose server response differs from the canonical resource.

Current reportability:

- Not VRP-grade standalone yet. It is a real chain primitive, but report quality depends on finding a default/scalable app pattern where Angular encourages or commonly emits this configuration for security-sensitive resources.

Next expansion:

- Search Angular docs/examples and generated configs for `resources.urls` + `ignoreSearch`.
- Test whether `ngsw-config` examples or common runtime-config recipes place `/assets/config*.json`, `/config.json`, or `/settings.json` into asset groups with `ignoreSearch`.
- Check if manifest glob conversion can make narrower URL patterns overmatch query-bearing variants unexpectedly.
