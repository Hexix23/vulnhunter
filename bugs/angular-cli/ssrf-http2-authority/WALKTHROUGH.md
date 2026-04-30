# WALKTHROUGH — @angular/ssr SSRF via HTTP/2 `:authority` pseudo-header

## 1. Invariant claimed by the framework

`@angular/ssr` claims that `validateRequest` and the `allowedHosts` configuration together prevent an attacker-controlled hostname from appearing in the server-side `request.url`. Documentation in `AngularAppEngine.handle()` states: *"To prevent potential Server-Side Request Forgery (SSRF), this function verifies the hostname of the `request.url` against a list of authorized hosts. If the hostname is not recognized a 400 Bad Request is returned."* (`packages/angular/ssr/src/app-engine.ts:120-130`)

That claim is structurally dependent on two pieces of code:

- `validateHeaders` — character-class gate on the incoming hostname strings, bounded by the set `HOST_HEADERS_TO_VALIDATE`.
- `validateUrl` — allowlist gate on the final URL hostname.

For the invariant to hold, every source that can populate `request.url`'s hostname must be fed through both gates.

## 2. Code-level gap

Three files, three lines. All in `@angular/ssr@21.2.8`:

1. `packages/angular/ssr/src/utils/validation.ts:12`
   ```ts
   const HOST_HEADERS_TO_VALIDATE: ReadonlySet<string> = new Set(['host', 'x-forwarded-host']);
   ```
   `:authority` is not in the set. The char-class regex `VALID_HOST_REGEX` (line 27) never runs against pseudo-header values.

2. `packages/angular/ssr/node/src/request.ts:91`
   ```ts
   const hostname =
     getFirstHeaderValue(headers['x-forwarded-host']) ?? headers.host ?? headers[':authority'];
   ```
   `:authority` is read raw — no `getFirstHeaderValue`, no character-class check. If both higher-priority headers are absent, the URL is built entirely from the pseudo-header.

3. `packages/angular/ssr/node/src/request.ts:58`
   ```ts
   if (HTTP2_PSEUDO_HEADERS.has(name)) { continue; }
   ```
   The pseudo-header is dropped from the downstream Web `Request.headers`. Even if `HOST_HEADERS_TO_VALIDATE` were later extended to include `:authority`, `Request.headers.get(':authority')` would return `null` and `validateHeaders` would not fire. A correct fix must therefore either normalize the pseudo-header inside `createRequestUrl` before URL construction, or re-inject a synthetic header name for validation prior to the strip.

## 3. Parser quirks

Node's `node:http2` compatibility API does not auto-populate `req.headers.host` from `:authority`. An HTTP/2 client that sends only the pseudo-header leaves `headers.host` and `headers['x-forwarded-host']` both undefined, so the fallback lands on `headers[':authority']`. This is confirmed in `evidence/04-raw-headers.txt`:

```
{ ":method": "GET", ":path": "/", ":authority": "custom.authority.example:9999", ":scheme": "http" }
```

The `host` key is absent. This is the default path taken by HTTP/2 clients — the `:authority` pseudo-header is the canonical hostname channel in HTTP/2; `Host` is legal but deprecated (RFC 9113 §8.3.1).

Additionally, because Node's HTTP/2 server enforces authority format at the protocol layer, characters like `@` raise `NGHTTP2_PROTOCOL_ERROR` and do not reach the handler. This limits the character-class bypass surface to the characters node's parser accepts, but it does **not** close the port-pivot exploit — ports are permitted by `:authority`'s grammar.

## 4. Realistic consumer pattern

Two documented patterns match the PoC's `app.ts` and `server.ts`:

- **SSR-time fetch driven by `inject(REQUEST).url`.** The `REQUEST` token is a public Angular export intended for server-side use, and the "build a URL from the incoming request origin, fetch, render" pattern appears in Angular SSR guide samples and in third-party canonical-URL / self-probe utilities. The PoC uses this to observe the leak.

- **Direct HTTP/2 termination at the Node process via `AngularNodeAppEngine.handle()`.** The `handle()` signature explicitly types `Http2ServerRequest` as an acceptable input (`app-engine.ts:50-74`). The PoC's `src/server.ts` constructs a `node:http2` server and calls the public handler. No private imports are used.

## 5. Framework-internal consumer check

The SSR `HttpClient` provider (via `withFetch()`) treats the incoming `request.url` origin as the default base for relative fetches. Any component-level `HttpClient.get('/something')` during SSR therefore resolves against the attacker-controlled host:port. The PoC uses an explicit absolute URL for clarity but the same primitive exists for every relative call in a typical SSR app.

## 6. Three-probe isolation

Probes run with timestamp-bound secrets so replay cannot be forged.

| Probe | Request | Expected | Observed |
|-------|---------|----------|----------|
| Baseline | `:authority: 127.0.0.1:4000` | Self-fetch; no internal token in body | `probe.body=Http failure ...` (SSR hits its own Angular stack for `/probe`; the point is that no external port is reached) |
| Exploit | `:authority: 127.0.0.1:13306` | Internal token from 13306 appears in HTML | `probe.body=SECRET-INTERNAL-c9-internal-1777041745`, and `ng-state` pins `u: "http://127.0.0.1:13306/probe"` |
| Control | `:authority: evil.example` | 400 from `validateUrl` | `STATUS 400 — URL with hostname "evil.example" is not allowed.` |

Baseline proves the framework does not reach an external port without the attacker pseudo-header. Exploit proves the attacker-chosen port is reached and the response is inlined. Control proves `validateUrl`'s allowlist is operative for disallowed hostnames — the bug is specifically the allowlisted-host port dimension through the pseudo-header channel.

## 7. How to verify yourself

From scratch (approx. 5 minutes):

```bash
cd /tmp && cp -r <PoC-archive>/poc c9-authority && cd c9-authority
rm -rf node_modules package-lock.json
npm install
npx ng build

TS=$(date +%s)
INTERNAL_SECRET="mysql-root-$TS" node mock-internal.mjs &
SELF_SECRET="public-$TS" PORT=4000 node dist/xfh-comma-leak/server/server.mjs &
sleep 2

node probe.mjs 127.0.0.1:4000    > /tmp/p-baseline.txt 2>&1
node probe.mjs 127.0.0.1:13306   > /tmp/p-exploit.txt  2>&1
node probe.mjs evil.example      > /tmp/p-control.txt  2>&1

grep -c "SECRET-INTERNAL-$TS" /tmp/p-exploit.txt   # expect 2 (HTML pre + ng-state)
grep -c "SECRET-INTERNAL-$TS" /tmp/p-baseline.txt  # expect 0
grep -c "not allowed"         /tmp/p-control.txt   # expect 1
```

Two grep lines tell you unambiguously whether the bug reproduced against the build you just compiled.

## 8. What the bug is not

- **Not a client-side bug.** Angular's client SSR hydration is not involved. The leak is in the server-rendered HTML.
- **Not a path-parsing bug.** This is orthogonal to CVE-2025-62427 (path hijack). Any `:path` value works; the bug is in hostname selection.
- **Not the same as CVE-2026-27739.** That fix introduced `HOST_HEADERS_TO_VALIDATE` and the character-class regex. Both are scoped to HTTP/1 headers and were not extended to HTTP/2 pseudo-headers in the same PR.
- **Not identical to the `X-Forwarded-Host` port-pivot finding.** That finding targets the allowlist semantics at `isHostAllowed` (`validation.ts:243-260`). This finding targets the validation scope at `HOST_HEADERS_TO_VALIDATE` (`validation.ts:12`) and the URL construction fallback at `request.ts:91`. A fix at one site does not automatically cover the other; see report § "Relation to companion finding".
- **Not dependent on TLS.** The PoC uses h2c (HTTP/2 cleartext) for brevity. `http2.createSecureServer` behaves identically for the validation flow.
- **Not blind.** The internal response body is echoed back in the SSR HTML and in the serialized `ng-state`.

## 9. Proposed fix

Two minimum changes. See the VRP report § "Suggested Fix" for the full form; summary:

1. `createRequestUrl` (`request.ts:91`) — pass the `:authority` value through `getFirstHeaderValue` and `VALID_HOST_REGEX` before URL construction. Throw if the char-class fails.
2. Document that the char-class gate is enforced at the URL-construction layer for channels that do not survive into the Web Request (pseudo-headers). If `HOST_HEADERS_TO_VALIDATE` continues to be the sole declarative enumeration, synthetic re-injection of `:authority` under `host` before the pseudo-header strip is the cheapest refactor.

Complementary: the X-Forwarded-Host port-pivot finding recommends `isOriginAllowed` in place of `isHostAllowed`. With that change, the port dimension is enforced on the final URL uniformly across channels, which is the minimum-variance mitigation across this finding and the companion one.

## 10. CVSS justification

`7.5 (AV:N/AC:H/PR:N/UI:N/S:C/C:H/I:L/A:N)`

- AV:N — network-reachable HTTP/2 endpoint.
- AC:H — requires the deployment to terminate HTTP/2 at the Node process, and requires an allowlisted hostname that also resolves services on other ports. These are real but narrower conditions than the HTTP/1 port-pivot case.
- PR:N, UI:N — no auth, no user interaction.
- S:C — when the internal port hosts a service with a different security authority (e.g., IMDS 169.254.169.254:80 is the canonical Scope-Change case for SSRF; when the allowlist includes a local hostname that resolves to IMDS via NAT or routing, the same mechanics apply to port-based separation).
- C:H — response body inlined in HTML, same evidentiary channel as the companion port-pivot finding.
- I:L — limited write primitives (method is GET in the PoC; HTTP/2 `:method` supports any verb, so POST/PUT to internal endpoints is reachable but scoped to what those endpoints accept).
- A:N — no availability impact claimed.

If a reviewer does not credit Scope Change (i.e., treats the SSR process and the internal port as the same security authority), the score drops to 6.5 (`AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:L/A:N`).
