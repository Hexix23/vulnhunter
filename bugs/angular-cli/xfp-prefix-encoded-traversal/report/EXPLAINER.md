# What We Found

Angular's server-side rendering package (`@angular/ssr`) accepts an `X-Forwarded-Prefix` header that lets a reverse proxy tell the server which subpath the site is mounted under. The framework checks that header for `..` path traversal by pattern-matching on the literal characters, but does not decode percent-encoded characters before the check. When the attacker sends `X-Forwarded-Prefix: foo/%2e%2e/bar`, the check is satisfied because `%2e%2e` is not literal `..`, but web browsers normalize `%2e%2e` as a dot-segment when they follow a `Location` redirect, so the client ends up one directory above the prefix. The attacker controls the path after the percent-encoded segment, which means the final path is attacker-chosen within the origin.

## Who Is Affected

Applications that use `@angular/ssr` 21.2.8 (and earlier versions that include `INVALID_PREFIX_REGEX`) with SSR enabled and any route configured with `redirectTo:` (the canonical Angular Router pattern). The scaffold produced by `ng new --ssr` plus a single `redirectTo:` entry is sufficient to reproduce. The header is the default way to scope Angular apps mounted under a subpath behind nginx / HAProxy / Cloudflare, so deployments that forward this header from clients are in scope.

## What Could Happen

One HTTP request, no authentication, no user interaction. The attacker controls the path a victim lands on after clicking a link to the legitimate origin. Practical targets include:

- OAuth / SSO callback routes: the attacker routes the victim to the callback URL with an attacker-controlled fragment or query, useful for token-binding or authorization-code-exchange manipulations.
- Multi-tenant mount-point escape: deployers use `X-Forwarded-Prefix` to scope tenant A to `/tenant-a/*`. An attacker link with an `%2e%2e` prefix escapes the tenant mount and reaches content in the sibling tenant's path.
- Stepping stone for any existing vulnerability at the redirect destination, since the initial hop is the legitimate origin.

## Recommendation

Apply the patch once `@angular/ssr` ships an update that decodes and canonicalizes the prefix before validation. Until then, configure the reverse proxy or load balancer to strip `X-Forwarded-Prefix` from incoming client requests and set it only from a trusted value, or reject any `X-Forwarded-Prefix` containing `%`.
