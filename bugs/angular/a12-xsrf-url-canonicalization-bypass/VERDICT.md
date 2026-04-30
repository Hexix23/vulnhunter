# A12 - GHSA-58c5-g7wp-6w37 XSRF URL canonicalization bypass search

IMPACT_CLASS: SECURITY_LOGIC

VERDICT: REFUTED_DIRECT_VARIANT / EXISTING_A8_CHAIN_REQUIRED

One-line reason: After the `new URL(req.url, locationOrigin)` fix, the tested browser-cross-origin URL forms are also classified cross-origin by Angular and do not receive `X-XSRF-TOKEN`; the remaining confirmed mismatch is A8's cross-origin `<base href>` chain primitive.

## Prior CVE contract

GHSA-58c5-g7wp-6w37 / CVE-2025-66035 was a credential leak in `@angular/common` where protocol-relative request URLs (`//attacker.example/...`) were treated as relative/same-origin and received the XSRF header.

Fix lineage in this checkout:

- `05fe6686a9` / `0276479e7d`: introduced an absolute/protocol-relative regex, `ABSOLUTE_URL_REGEX = /^(?:https?:)?\/\//i`.
- `20474d3f0f` / `0659d11c85`: replaced the regex with WHATWG URL origin comparison:

```ts
const locationHref = inject(PlatformLocation).href;
const {origin: locationOrigin} = new URL(locationHref);
const {origin: requestOrigin} = new URL(req.url, locationOrigin);
if (locationOrigin !== requestOrigin) {
  return next(req);
}
```

Code: `packages/common/http/src/xsrf.ts:93-126`.

## Sinks and boundary

- Header decision: `xsrfInterceptorFn()` uses `req.url`.
- Network sink:
  - Fetch backend sends `request.urlWithParams`: `packages/common/http/src/fetch.ts:100`.
  - XHR backend sends `req.urlWithParams`: `packages/common/http/src/xhr.ts:159`.
- Request URL construction appends params after `?`/`&`: `packages/common/http/src/request.ts:545-566`.

The important invariant is not "string starts with http"; it is "the origin used by the XSRF decision equals the effective browser network origin."

## Browser matrix

Chrome 147 headless tested these URL families from an ordinary same-origin document with no attacker-controlled `<base href>`:

- protocol-relative: `//attacker`
- triple/quad slash: `///attacker`, `////attacker`
- leading backslashes: `\\attacker\path`
- slash + backslash: `/\\attacker/path`
- scheme with slash/backslash confusion: `http:////attacker`, `http:/\\attacker`, `http:\\attacker\path`
- leading whitespace/control chars before `//`
- encoded separators: `/%2f%2fattacker`, `/%5c%5cattacker`
- userinfo: `http://victim@attacker/path`
- path/query authority-looking strings: `/safe/..//attacker`, `/path?next=//attacker`

Result:

- Every URL that Chrome sent to the attacker server had `new URL(url, location.origin).origin !== location.origin`.
- Encoded separators and path/query authority-looking strings stayed on the origin server and were classified same-origin.
- Userinfo URL was classified cross-origin by `new URL`; Chrome rejected it before sending.

Evidence:

- `poc/browser_url_matrix_probe.mjs`
- `evidence/2026-04-29-browser-url-canonicalization-matrix.json`

## Angular interceptor probe

Temporary Angular framework test added two A12 probes to `packages/common/http/test/xsrf_spec.ts`:

- browser-cross-origin unusual URL forms must not get `X-XSRF-TOKEN`,
- encoded/path-looking authority strings remain same-origin and do get `X-XSRF-TOKEN`.

Command:

```bash
bazelisk --output_user_root=/tmp/vulnhunter-bazel-user test //packages/common/http/test:test --test_filter='A12 probe'
```

Result: passed.

Evidence:

- `poc/a12_xsrf_url_matrix_probe.patch`
- `evidence/2026-04-29-angular-xsrf-a12-url-matrix.log`

## Params / `urlWithParams` note

The XSRF decision uses `req.url`, while fetch/XHR use `urlWithParams`. That is a meaningful review point, but in current `HttpRequest` construction params are appended after an existing URL as query data:

- no params: `urlWithParams = url`
- with params: `url + '?' + params` or `url + '&' + params`

This can alter query/fragment-like content but does not create a new authority before the path. The browser matrix included `/path?next=//attacker`, and it stayed same-origin. No direct credential-leak primitive was found through params.

## Relationship to A8

A8 remains valid as a bounded primitive:

- Browser request resolution for relative URLs honors document `<base href>`.
- Angular's XSRF decision resolves against `PlatformLocation.href` origin, not `document.baseURI`.
- With attacker-controlled cross-origin `<base href>`, a relative `HttpClient` request can receive the XSRF header while the browser sends the request cross-origin.

That still requires a separate realistic chain: attacker-controlled or misconfigured cross-origin base URL plus CORS acceptance of the XSRF header. It is not a direct bypass of the GHSA-58 fix.

## Reportability

No new standalone report candidate from A12.

The direct URL-canonicalization variant class appears closed for the tested URL families. Keep A8 catalogued as a chain-required primitive, and move to the next CVE seed.
