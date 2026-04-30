# What We Found

Angular's server-side rendering package (`@angular/ssr`) patches the `Headers.get()` method on incoming requests so that every time server-side code reads a forwarded hostname header, the value goes through an allowlist check. The check only looks at the first comma-separated token of the header. The patched `get()` then returns the full original header string to the caller, including anything after the first comma. Because WHATWG URL parsing treats `allowed-host,@attacker-host` as userinfo followed by a real host, any server-side application code that parses the returned value into a URL and makes a request from it ends up reaching the attacker-chosen endpoint.

The framework itself uses its own internal splitting helper when it builds the request URL, so `request.url` stays safe. The leak is only visible to application code that consumes the forwarded host through the patched reader.

## Who Is Affected

Applications running `@angular/ssr` 21.2.8 (and earlier versions that include the patched `cloneRequestAndPatchHeaders`) with server-side rendering enabled, where the SSR code reads the forwarded host to build outbound HTTP requests, canonical links, OAuth redirect URIs, password-reset templates, cookie domains, or any other security-relevant string. Typical deployments behind a reverse proxy (AWS, Google Cloud, Azure, Cloudflare, nginx, Apache, Kubernetes) pass the forwarded header through by default.

## What Could Happen

An unauthenticated request with one header takes over what the server thinks "the forwarded host" is for any code that reads the raw value. The primary validation lets the request through because the first comma-separated token is on the allowlist. What comes after the first comma is the attacker's choice. The application code that treats the returned value as "already validated" now fetches from, links to, or issues cookies for the attacker's host.

Concrete consequences depend on the specific place in the application that reads the header. The worst realistic case demonstrated in this submission is extraction of AWS IAM role credentials from the cloud instance metadata service (IMDS at 169.254.169.254). The attacker sends the exploit, the SSR process fetches IMDS, and the JSON credential document is rendered into the HTML returned to the attacker, who then uses the extracted keys against the AWS API. The CVSS base score for this scenario is 7.5 High (`AV:N/AC:H/PR:N/UI:N/S:C/C:H/I:L/A:N`). Lower-impact sinks (canonical link injection, OAuth redirect_uri steering, session cookie hijack via Set-Cookie Domain echo) scale from 4.8 Medium to 8.7 High depending on what the application code does with the value.

## Recommendation

Apply the patch once `@angular/ssr` ships a release that canonicalizes the host headers in `cloneRequestAndPatchHeaders`, equivalent to the treatment already applied to `x-forwarded-prefix`. Until then, configure the reverse proxy to drop `X-Forwarded-Host` from incoming client requests and set it only from trusted values. If the reverse proxy cannot be reconfigured, do not read `x-forwarded-host` (or the `host` header) in application code to build outbound URLs or links; use a fixed configuration value, or normalize the header value manually by splitting on the first comma before passing it anywhere.
