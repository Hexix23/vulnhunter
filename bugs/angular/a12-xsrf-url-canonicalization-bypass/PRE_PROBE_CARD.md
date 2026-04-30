# A12 - GHSA-58c5-g7wp-6w37 XSRF URL canonicalization bypass search

Target: `targets/angular`

Phase: CVE-derived

Prior CVE class: XSRF token leakage via URL origin misclassification.

Advisory/fix source:
- GHSA-58c5-g7wp-6w37 / CVE-2025-66035.
- Local fix lineage:
  - `05fe6686a9` / `0276479e7d`: block absolute and protocol-relative URLs with `ABSOLUTE_URL_REGEX`.
  - `20474d3f0f` / `0659d11c85`: replace regex with `new URL(req.url, locationOrigin)` origin comparison so same-origin absolute URLs still receive XSRF.

Fix diff files:
- `packages/common/http/src/xsrf.ts`
- `packages/common/http/test/xsrf_spec.ts`

Invariant: The decision to attach `X-XSRF-TOKEN` must use the same effective origin that the browser backend will use for the actual network request.

Entry point: Ordinary Angular `HttpClient` mutating request (`POST`, `PUT`, `PATCH`, `DELETE`) with default XSRF protection.

Trust boundary: Application-controlled or attacker-influenced request URL crosses into a credential/header attachment decision.

High-risk operation: Origin comparison and header injection.

Attacker model: Web attacker can influence a URL string used by an Angular app for a mutating `HttpClient` request, but cannot execute arbitrary script or call `bypassSecurityTrust*`. The app otherwise uses normal `HttpClient`.

Sink: `xsrfInterceptorFn()` attaches `X-XSRF-TOKEN`; `FetchBackend` / `HttpXhrBackend` sends `req.urlWithParams`.

Attacker-controlled value: Request URL and, secondarily, request params.

Expected violation: A URL form for which Angular computes `requestOrigin === locationOrigin`, but browser `fetch()` or XHR sends the request to an attacker origin.

Canonical runtime:
- Angular framework test for header attachment.
- Chrome headless page for actual browser request target.
- Promote to minimal Angular browser app only if a mismatch survives both.

Oracle:
- Angular classification: `new URL(req.url, locationOrigin).origin`.
- Browser target: captured request on same-origin vs attacker-origin HTTP servers.
- Reportable only if the same string receives `X-XSRF-TOKEN` and reaches attacker origin in a normal browser backend.

Reportability bar: VRP candidate if an ordinary Angular app leaks the XSRF token to attacker-controlled origin without requiring arbitrary HTML/script injection or non-default app code.

Stop condition: If all tested browser-cross-origin URL forms are classified cross-origin by Angular, and the only known mismatch remains `<base href>` control, mark this CVE closed for Phase 1 as chain-required.
