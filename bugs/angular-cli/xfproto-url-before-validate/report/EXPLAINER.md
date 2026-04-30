# What We Found

Angular's server-side rendering package (`@angular/ssr`) validates the `X-Forwarded-Proto` header so that only `http` or `https` reaches its URL construction logic, and malformed headers should return a clean 400 Bad Request. The validation runs one step too late: the Node adapter first feeds the attacker-controlled header into JavaScript's `new URL()`, which throws on structurally invalid scheme bytes (for example `http%00`). The exception bypasses the validator, surfaces as an Internal Server Error, and in the default scaffold configuration returns a full stack trace exposing the server's absolute filesystem paths.

## Who Is Affected

Applications that use `@angular/ssr` 21.2.8 with SSR enabled behind a reverse proxy that forwards client-supplied `X-Forwarded-Proto`. The default scaffold produced by `ng new --ssr` reproduces the issue.

## What Could Happen

One HTTP request, no authentication, no user interaction. The attacker sets `X-Forwarded-Proto: http%00`. The server returns HTTP 500 instead of the intended 400 for every such request. In the default (development) configuration, the response body contains a Node.js stack trace including absolute paths to the deployed server bundle. In production (`NODE_ENV=production`), the stack body is suppressed to a generic error page, but the 500 response is still returned — so any request can replace a valid 4xx with a 5xx, affecting error budgets, alerting, and WAF / observability rules keyed on the validator's 400 message.

Impact profile:

- Information disclosure: server install path on disk, Node version specifics from the stack frames.
- Availability / behavior: uncontrolled 500 on every attacker-supplied malformed request.
- Authorization-consistency failure: the validator's contract — "malformed → controlled 400" — is silently subverted.

## Recommendation

Apply the patch once `@angular/ssr` ships an update that either validates `X-Forwarded-Proto` before constructing the URL, or wraps the URL construction in a try/catch that routes failures through the normal validation-error handler. Until then, configure the reverse proxy to strip `X-Forwarded-Proto` from incoming client requests and set it only from a trusted value.
