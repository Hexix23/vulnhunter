# VRP form fields

## Title

SSRF in Angular platform-server SSR through Host-derived render URL

## Product

Angular

## Component

`@angular/platform-server`

## Vulnerability type

Server-Side Request Forgery, CWE-918

## Severity

High

Suggested CVSS v4.0:

```text
CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:N/VC:H/VI:L/VA:N/SC:L/SI:L/SA:N
```

Conservative CVSS v3.1:

```text
CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:L/I:L/A:N
```

## Short description

Angular `platform-server` resolves server-side relative `HttpClient` requests
against the origin stored in `ServerPlatformLocation`. In direct SSR
applications that build `renderApplication({url})` from the untrusted `Host`
header, a remote attacker can control that origin. A relative server-side
`HttpClient` request is then rewritten to an attacker-chosen host and port.

## Reproduction summary

1. Build Angular's `integration/platform-server` standalone SSR app.
2. Start the compiled SSR server.
3. Start an attacker listener.
4. Send a request to the SSR server with:

```http
Host: victim.test@127.0.0.1:<attacker-port>
```

5. Visit the route that performs `HttpClient.get('/api-2')` during SSR.
6. Observe that the attacker listener receives `/api-2`.
7. Observe that the attacker-controlled response is rendered into the SSR HTML.

## Evidence path

```text
bugs/angular/a1-ssr-url-origin-reconstruction/evidence/2026-04-29-macos-compiled-standalone-app-probe.json
```

## Impact statement

The vulnerable SSR server can be induced to make outbound HTTP requests to a
host and port selected by the attacker. This can expose internal services
reachable from the SSR process and can poison server-rendered HTML with
attacker-controlled response data. The impact is stronger when the application
adds server-side authorization headers to relative `HttpClient` requests.

## Suggested fix

Validate the render URL origin before using it as the base for server-side
relative `HttpClient` requests. Treat request-derived render URLs as path-only
by default, or require an explicit trusted origin allowlist. Update the Angular
Express SSR integration pattern so it does not pass `headers.host` directly into
`renderApplication({url})`.
