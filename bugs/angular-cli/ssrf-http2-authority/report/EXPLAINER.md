# What We Found

Angular's server-side rendering package (`@angular/ssr`) validates a small set of HTTP headers before building the request URL it uses for server-rendered fetches. When a client speaks HTTP/2 directly to the Node process, the `:authority` pseudo-header carries the hostname. `@angular/ssr` uses that pseudo-header as a fallback source for the request hostname, but does not include it in the header validation set. A crafted HTTP/2 request with `:authority: <allowed-host>:<other-port>` causes the Angular server to issue its internal network requests to the attacker-chosen port on the allowed host. Because SSR runs the application's own HTTP calls, the response from that port is rendered into the page returned to the attacker.

## Who Is Affected

Applications that use `@angular/ssr` 21.2.8 (and earlier) with SSR enabled, where the Node process terminates HTTP/2 directly. This is the configuration documented by the `AngularNodeAppEngine.handle()` signature, which accepts `Http2ServerRequest` as a first-class input type. It applies to deployments that use `node:http2`, `http2.createSecureServer`, Fastify's HTTP/2 adapter, and reverse-proxy setups configured for HTTP/2 passthrough to origin.

## What Could Happen

One HTTP/2 request, no authentication, no user interaction. The attacker sets `:authority` to an allowlisted hostname with a different port number. The Angular server performs its own internal requests to that port and returns the response inside the HTML it renders. If the allowlisted host also runs a database, an admin interface, a cloud metadata service, or any other HTTP-speaking service on another port, the attacker reads that service's output through the Angular response. Typical targets are cloud instance metadata (which can expose short-lived credentials), co-hosted admin panels, databases exposing HTTP debug endpoints, and sidecar services on container platforms.

The attack channel survives reverse proxies that strip or canonicalize `Host` and `X-Forwarded-Host` on ingress, as long as the proxy is configured for HTTP/2 passthrough to origin. The validation gap is specifically in the pseudo-header path, and existing HTTP/1-style header hardening does not cover it.

## Recommendation

Apply the patch once `@angular/ssr` ships an update that normalizes the `:authority` pseudo-header and enforces the same character-class and host-allowlist checks that `Host` and `X-Forwarded-Host` receive. Until then, terminate HTTP/2 at a reverse proxy that does not pass pseudo-headers to origin (convert to HTTP/1 to origin), or restrict the allowlisted host to the SSR service only. Setting `allowedHosts: ["*"]` does not help and makes the situation worse.
