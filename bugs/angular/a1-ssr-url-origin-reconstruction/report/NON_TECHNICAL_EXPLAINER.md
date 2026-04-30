# Non-technical explainer

## What we found

Angular server-side rendering can use the incoming request host as the base
address for server-side HTTP requests. If an application builds the render URL
from the `Host` header and then makes a relative `HttpClient` request during
SSR, an attacker can choose where that server-side request goes.

This was reproduced with Angular's compiled `platform-server` integration app.

## Who is affected

Applications are affected when they use direct or legacy `@angular/platform-server`
SSR and build the render URL from request headers without validating the host.

Applications are less likely to be affected when a trusted proxy rejects invalid
or untrusted `Host` values before traffic reaches Node, or when the newer
`@angular/ssr` engines validate the host.

## What could happen

An attacker can make the SSR server connect to an internal or attacker-controlled
HTTP service. The attacker can also control data that is inserted into the SSR
HTML response if the rendered Angular component displays the result of the
relative HTTP request.

In real deployments, this can expose internal services or poison rendered
content. If the application adds authorization headers to server-side
`HttpClient` requests, those headers may be sent to the attacker-controlled host.

## Recommendation

Angular should avoid trusting the render URL origin for server-side relative
HTTP requests unless that origin has been validated. Angular's Express SSR
sample should also validate `Host` or use a configured trusted origin instead
of directly using `headers.host`.
