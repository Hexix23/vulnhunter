# Modern Angular SSR Deep Expansion

Date: 2026-04-28

## Scope

This pass focuses only on modern `@angular/ssr` request handling, not direct legacy
`@angular/platform-server` usage.

Relevant code:

- `@angular/ssr/fesm2022/node.mjs:createWebRequestFromNodeRequest()`
- `@angular/ssr/fesm2022/node.mjs:createRequestUrl()`
- `@angular/ssr/fesm2022/_validation-chunk.mjs:validateRequest()`
- `@angular/ssr/fesm2022/_validation-chunk.mjs:validateHeaders()`
- `@angular/ssr/fesm2022/ssr.mjs:AngularAppEngine.handle()`

## Modern Request URL Construction

`@angular/ssr/node` does not pass raw `req.url` directly to `platform-server`. It first constructs a
full Web `Request` URL:

```js
const protocol =
  getFirstHeaderValue(headers['x-forwarded-proto']) ??
  ('encrypted' in socket && socket.encrypted ? 'https' : 'http');
const hostname =
  getFirstHeaderValue(headers['x-forwarded-host']) ??
  headers.host ??
  headers[':authority'];
...
return new URL(`${protocol}://${hostnameWithPort}${originalUrl ?? url}`);
```

Then `AngularAppEngine.handle()` calls:

```js
validateRequest(request, allowedHost, disableAllowedHostsCheck);
```

The validation path checks:

```js
const VALID_HOST_REGEX = /^[a-z0-9_.-]+(:[0-9]+)?$/i;
const VALID_PROTO_REGEX = /^https?$/i;
const VALID_PORT_REGEX = /^\d+$/;
const INVALID_PREFIX_REGEX = /^(?:\\|\/[/\\])|(?:^|[/\\])\.\.?(?:[/\\]|$)/;
```

and rejects if `new URL(request.url).hostname` is not in `allowedHosts`.

## Variant Matrix

The matrix below used Angular's real exported `validateRequest()` and an exact local reproduction of
`createRequestUrl()` because `createRequestUrl()` is not exported.

Allowed host set:

```js
new Set(['victim.test'])
```

Results:

```json
{"name":"safe","built":"http://victim.test/p","validation":"accepted"}
{"name":"raw absolute malformed","error":"URL with hostname \"victim.testhttp\" is not allowed."}
{"name":"raw absolute normal","error":"URL with hostname \"victim.testhttp\" is not allowed."}
{"name":"raw protocol relative","built":"http://victim.test//attacker.test/p","validation":"accepted"}
{"name":"host userinfo","error":"Request cannot be constructed from a URL that includes credentials: http://victim.test@attacker.test/p"}
{"name":"xfh userinfo","error":"Request cannot be constructed from a URL that includes credentials: http://victim.test@attacker.test/p"}
{"name":"xfh allowed host, host attacker","built":"http://victim.test/p","validation":"accepted"}
{"name":"xfh comma","built":"http://victim.test/p","validation":"accepted"}
{"name":"xfp javascript","error":"Header \"x-forwarded-proto\" must be either \"http\" or \"https\"."}
{"name":"xfp comma","built":"https://victim.test/p","validation":"accepted"}
{"name":"xfprefix protocol","built":"http://victim.test/p","validation":"accepted"}
{"name":"xfprefix encoded slash","built":"http://victim.test/p","validation":"accepted"}
```

## Findings

### Refuted for modern default: malformed absolute request target

The legacy `platform-server` primitive:

```text
http:///attacker.test/p
```

does not survive modern `@angular/ssr` request construction when `allowedHosts` is configured to the
real host. It becomes a host like `victim.testhttp`, which fails allowed-host validation.

### Refuted for modern default: Host userinfo

The legacy Host header variant:

```text
Host: victim.test@attacker.test
```

does not survive modern `@angular/ssr` because the constructed Web `Request` rejects URLs containing
credentials before Angular rendering. The validation layer also rejects `@` in `Host` /
`X-Forwarded-Host`.

### Benign / expected: protocol-relative target

```text
//attacker.test/p
```

becomes:

```text
http://victim.test//attacker.test/p
```

This is a same-origin path under the validated host, not an attacker origin.

### Not SSRF by itself: X-Forwarded-Host precedence

If:

```text
Host: attacker.test
X-Forwarded-Host: victim.test
```

then `createRequestUrl()` builds `http://victim.test/...` and validation accepts. This does not
pivot server-side `HttpClient` to the attacker. It can leave `Host` and `request.url` disagreeing,
but Angular wraps request headers and validates Host-like headers on access. This is not currently a
confirmed vulnerability.

### Weak observation: X-Forwarded-Prefix percent-encoding

`X-Forwarded-Prefix` validation does not decode percent-encoded slashes or dot segments. For
example `/%2f%2fattacker.test` passes the regex. In the tested redirect construction helper,
however, it is joined into a path such as:

```text
/%2f%2fattacker.test/target
```

not an external `Location: //attacker.test/...`. No open redirect or SSRF was confirmed from this
path.

## Current Modern SSR Verdict

No exploitable default-modern `@angular/ssr` SSRF was confirmed in this pass.

The confirmed issue remains limited to:

- Direct `@angular/platform-server` use with attacker-controlled `INITIAL_CONFIG.url`.
- Legacy/direct Express SSR patterns that build render URL from raw `headers.host` and
  `originalUrl`.

Modern `@angular/ssr` should stay in the threat model because the request canonicalization logic is
security-critical, but the currently tested bypasses are refuted for default modern SSR.

