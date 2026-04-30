# What We Found

Angular's server-side rendering package (`@angular/ssr`) lets the server check incoming requests against an allowlist of hostnames, so that an attacker cannot trick the server into connecting to an arbitrary machine. The check only looks at the hostname. It does not look at the port. An attacker who sends an HTTP header that specifies any numeric port causes the Angular server to issue its internal network requests to that port on the allowed host. Because SSR runs the application's own HTTP calls, the response from that port is rendered into the page returned to the attacker.

## Who Is Affected

Applications that use `@angular/ssr` 21.2.8 (and earlier versions that include the `allowedHosts` validation) with server-side rendering enabled, deployed behind a reverse proxy or load balancer that forwards `X-Forwarded-Host` or `X-Forwarded-Port` headers from client requests. This is the default for the scaffold produced by `ng new --ssr` once `allowedHosts` is configured, and for typical deployments on AWS, Google Cloud, Azure, Cloudflare, and standard nginx/Apache reverse proxies.

## What Could Happen

One HTTP request, no authentication, no user interaction. The attacker sets `X-Forwarded-Host` to the allowlisted host with an added port number. The Angular server performs its own internal requests to that port and returns the response inside the HTML it renders. If the allowlisted host also runs a database, an admin interface, a cloud metadata service, or any other HTTP-speaking service on another port, the attacker reads that service's output through the Angular response. Typical targets are cloud instance metadata (which can expose short-lived credentials), co-hosted admin panels, databases exposing HTTP debug endpoints, and sidecar services on container platforms.

## Recommendation

Apply the patch once `@angular/ssr` ships an update that validates the port as part of the allowlist. Until then, configure the reverse proxy or load balancer to drop `X-Forwarded-Host` and `X-Forwarded-Port` from incoming client requests and set them only from trusted values. If the reverse proxy cannot be reconfigured, do not expose services on additional ports of the allowlisted host; restrict that host to the SSR service only. Setting `allowedHosts: ["*"]` does not help and makes the situation worse.
