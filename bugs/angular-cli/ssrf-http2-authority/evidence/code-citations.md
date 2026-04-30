# Code Citations

Target: `@angular/ssr@21.2.8` / `@angular/build@21.2.8`
Tree: `angular/angular-cli` @ `012239817487fbd3a404ced3bbf7b8dcbda2ff02`

## Validation scope — pseudo-header excluded

`packages/angular/ssr/src/utils/validation.ts:12`
```ts
const HOST_HEADERS_TO_VALIDATE: ReadonlySet<string> = new Set(['host', 'x-forwarded-host']);
```

`:authority` is not in the set. The char-class regex (`VALID_HOST_REGEX = /^[a-z0-9_.-]+(:[0-9]+)?$/i`, line 27) never runs against `:authority`.

`packages/angular/ssr/src/utils/validation.ts:268-293` (validateHeaders implementation)
```ts
function validateHeaders(request: Request): void {
  const headers = request.headers;
  for (const headerName of HOST_HEADERS_TO_VALIDATE) {
    const headerValue = getFirstHeaderValue(headers.get(headerName));
    if (headerValue && !VALID_HOST_REGEX.test(headerValue)) {
      throw new Error(`Header "${headerName}" contains characters that are not allowed.`);
    }
  }
  // ...
}
```

The iteration is bounded by `HOST_HEADERS_TO_VALIDATE`. No pseudo-header check exists. Additionally the pseudo-header is stripped from the Web `Request.headers` before this function runs (see `request.ts:58` below), so a post-hoc fix at this layer would have to reach upstream into `createWebRequestFromNodeRequest`.

## URL construction — pseudo-header used as fallback

`packages/angular/ssr/node/src/request.ts:80-106`
```ts
export function createRequestUrl(nodeRequest: IncomingMessage | Http2ServerRequest): URL {
  const { headers, socket, url = '', originalUrl } = nodeRequest as IncomingMessage & { originalUrl?: string };
  const protocol =
    getFirstHeaderValue(headers['x-forwarded-proto']) ??
    ('encrypted' in socket && socket.encrypted ? 'https' : 'http');
  const hostname =
    getFirstHeaderValue(headers['x-forwarded-host']) ?? headers.host ?? headers[':authority'];

  if (Array.isArray(hostname)) {
    throw new Error('host value cannot be an array.');
  }

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

`headers[':authority']` is read **raw** (no `getFirstHeaderValue`, no normalization) when `x-forwarded-host` and `host` are absent. In Node `http2.createServer()` this is the common case — per `node:http2` compatibility API, `req.headers` carries only the pseudo-header (`host` is **not** auto-populated; confirmed in `evidence/04-raw-headers.txt`).

## Pseudo-header stripped from Web Request downstream

`packages/angular/ssr/node/src/request.ts:20`
```ts
const HTTP2_PSEUDO_HEADERS = new Set([':method', ':scheme', ':authority', ':path', ':status']);
```

`packages/angular/ssr/node/src/request.ts:54-72`
```ts
function createRequestHeaders(nodeHeaders: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(nodeHeaders)) {
    if (HTTP2_PSEUDO_HEADERS.has(name)) {
      continue;
    }
    // ...
  }
  return headers;
}
```

The pseudo-header is dropped before the Web `Request` reaches `validateHeaders`. Consequence: downstream char-class check cannot see the `:authority` value even if `HOST_HEADERS_TO_VALIDATE` were extended, unless validation also runs at the node-layer before the Web Request is built, or `createRequestUrl` normalizes the `:authority` value through `getFirstHeaderValue` and the char-class regex.

## Entry point — handle() accepts Http2ServerRequest

`packages/angular/ssr/node/src/app-engine.ts:50-74`
```ts
/**
 * This method adapts Node.js's `IncomingMessage`, `Http2ServerRequest` or `Request`
 * ...
 */
async handle(
  request: IncomingMessage | Http2ServerRequest | Request,
  requestContext?: unknown,
): Promise<Response | null>
```

HTTP/2 is a documented first-class input type for the public API. The PoC's `src/server.ts` uses the `node:http2` server and this signature directly — no custom adapter, no private imports.

## Downstream URL allowlist — hostname-only

`packages/angular/ssr/src/utils/validation.ts:81-86, 243-260`
```ts
export function validateUrl(url: URL, allowedHosts: ReadonlySet<string>): void {
  const { hostname } = url;
  if (!isHostAllowed(hostname, allowedHosts)) {
    throw new Error(`URL with hostname "${hostname}" is not allowed.`);
  }
}

function isHostAllowed(hostname: string, allowedHosts: ReadonlySet<string>): boolean {
  if (allowedHosts.has('*') || allowedHosts.has(hostname)) {
    return true;
  }
  // wildcard handling
  return false;
}
```

The allowlist compares hostname only. Port is not enforced. An `:authority: 127.0.0.1:13306` request passes when `127.0.0.1` is in `allowedHosts` — the request URL is then built with port `13306`, and any framework-internal or consumer sink that fetches from `request.url`'s `parsed.host` reaches the attacker-picked port.
