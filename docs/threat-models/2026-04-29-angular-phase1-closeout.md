# Angular Phase 1 CVE-Derived Closeout

Date: 2026-04-29
Target: `targets/angular`
Scope: Angular framework CVE-derived Phase 1 only. This document does not start Phase 2.

## Phase 1 Status

Phase 1 is closed for the six initial Angular CVE seeds.

The only current VRP-ready candidate is A1. The remaining confirmed findings are bounded
primitives or chain-required behaviors that should feed Phase 2, not be submitted as standalone
high-impact reports yet.

## Final CVE Matrix

| Seed | Artifacts | Final verdict | Reportability | Decision |
|---|---|---|---|---|
| `GHSA-45q2-gjvg-7973` / `CVE-2026-41423` | A1 | `CONFIRMED_REPORT_CANDIDATE` | VRP candidate | Keep report package ready; submit after final wording review. |
| `GHSA-g93w-mfhg-p222` / `CVE-2026-32635` | A4, A15 | `CONFIRMED_BOUNDED_PRIMITIVE` + high-impact siblings refuted | Not standalone VRP | Catalog `link|href` ResourceURL downgrade as primitive. |
| `GHSA-prjf-86w9-mfqv` | A10, A16 | `CONFIRMED_BOUNDED_PRIMITIVE` + bypasses refuted | Not standalone VRP | Catalog ICU-created `srcset` image-fetch primitive. |
| `GHSA-v4hv-rgfq-gp49` | A11, A17 | `CONFIRMED_GAP_NOT_EXPLOITABLE` + namespace siblings refuted | Not standalone VRP | Catalog SVG URL-ish hardening gap as primitive. |
| `GHSA-58c5-g7wp-6w37` / `CVE-2025-66035` | A12, A8 | Direct bypass refuted; base-href chain primitive confirmed | Not standalone VRP | Catalog base-href XSRF mismatch as chain primitive. |
| `GHSA-68x2-mx4q-78m7` / `CVE-2025-59052` | A13, A14, A7 | Direct race refuted; TransferCache confusion confirmed separately | A7 plausible low/medium only with app chain | Catalog TransferCache key confusion. |

## VRP Submission Queue

### A1: SSRF in `@angular/platform-server` through Host-derived render URL

Status: submit candidate.

Evidence:

- `bugs/angular/a1-ssr-url-origin-reconstruction/VERDICT.md`
- `bugs/angular/a1-ssr-url-origin-reconstruction/report/VRP_REPORT.md`
- `bugs/angular/a1-ssr-url-origin-reconstruction/report/VRP_FORM_FIELDS.md`
- `bugs/angular/a1-ssr-url-origin-reconstruction/submission/a1-angular-platform-server-ssrf-attachment.zip`

Current report framing:

- Product: Angular
- Component: `@angular/platform-server`
- Class: SSRF / CWE-918
- Impact: attacker-selected outbound request destination from SSR process, attacker-controlled body rendered into SSR HTML, stronger if server-side interceptors attach credentials.
- Caveat: strongest in direct or legacy `platform-server` SSR patterns that build `renderApplication({url})` from `Host`; modern strict proxy/deployment validation can mitigate.

Submission action:

- Do not call this a variant of another finding.
- Present it as a framework + documented integration pattern issue: request-derived render origin controls server-side relative `HttpClient` origin.

## Non-Reportable Or Bounded Primitive Catalog

These are not standalone VRP submissions yet. They are Phase 2 seeds.

### P1: Direct i18n `link|href` ResourceURL downgrade

Artifact: A4, A15.

Primitive:

- Direct `<link href="{{url}}" i18n-href>` can write a plain HTTP(S) URL where normal Angular
  `link|href` binding would require `SafeResourceUrl`.
- Browser validation fetched stylesheet/preload/modulepreload resources.

Limits:

- No script execution confirmed.
- `iframe/embed/object` high-impact sibling sinks are compiler-rejected.
- `frame/base/script` variants did not emit a useful attribute in the framework runtime.

Phase 2 use:

- Chain with CSS/content integrity, preload/cache behavior, or CSP/Trusted Types assumptions.

### P2: Host binding ResourceURL case downgrade

Artifact: A3.

Primitive:

- `getUrlSanitizer(tag, prop)` dispatch is case-sensitive while Angular's schema invariant is
  case-insensitive.
- Generic host binding on uppercase tag or uppercase attr spelling can downgrade ResourceURL to URL
  for sinks such as `iframe|src`, `embed|src`, `frame|src`, `base|href`, and `link|href`.

Limits:

- Conditional app/library pattern required.
- URL sanitizer still blocks `javascript:`.
- No direct XSS demonstrated.

Phase 2 use:

- Search real generic host-binding directives/components that can be applied to ResourceURL-bearing
  elements with attacker-controlled URL input.

### P3: HttpTransferCache key confusion

Artifact: A7.

Primitive:

- Distinct SSR/hydration `HttpClient` requests can share the same TransferState key.
- Confirmed GET collision: `/query?a=1,2` vs `/query?a=1&a=2`.
- Confirmed POST collision when transfer caching is explicitly enabled.

Limits:

- Integrity confusion only unless a real app has semantically distinct auth/user-sensitive endpoints
  affected by the collision.
- POST path requires opt-in.

Phase 2 use:

- Find default SSR/hydration app patterns where repeated query parameters or GraphQL/read-style POST
  transfer caching influence auth, user data, or UI decisions.

### P4: XSRF base href origin mismatch

Artifact: A8, A12.

Primitive:

- Angular's XSRF interceptor resolves relative request origin against `PlatformLocation.href`.
- Browser fetch/XHR resolves relative URLs against document `<base href>`.
- With cross-origin base href and permissive CORS, relative mutating requests can carry
  `X-XSRF-TOKEN` cross-origin.

Limits:

- Requires attacker-controlled or misconfigured cross-origin `<base href>`.
- Direct URL canonicalization bypasses of the patched `new URL()` guard were refuted in A12.

Phase 2 use:

- Look for Angular-supported/documented base href flows, SSR/base tag injection, microfrontend base
  manipulation, or deployment patterns where base href is attacker-controlled without full XSS.

### P5: ICU-created `srcset`

Artifact: A10, A16.

Primitive:

- Malicious translation/ICU content can preserve `img[srcset]`, `picture/source[srcset]`, and
  `video/source[srcset]`.
- Chrome fetched image resources.

Limits:

- Parser-normalization bypasses were refuted.
- `javascript:` inside `srcset` did not execute in Chrome 147.
- No credential leak or cross-user impact observed.

Phase 2 use:

- Only useful if paired with a browser/image-side channel or application-specific sensitive image
  fetch behavior.

### P6: SVG URL-ish hardening gap

Artifact: A11, A17.

Primitive:

- Angular compiler leaves some SVG URL-like attribute bindings without sanitizer/validator:
  `use/image/mpath href` and `animate[by]`.
- Chrome fetched external SVG/image-like resources for some shapes.

Limits:

- No external SVG script execution.
- No `javascript:` execution.
- `animate[by]` did not mutate href in the tested browser.
- `foreignObject` and tested MathML namespace transitions are covered by sanitizers or fail closed.

Phase 2 use:

- Revisit only if a browser behavior, CSP interaction, or app-specific SVG resource chain gives
  content execution or meaningful integrity impact.

### P7: Service worker `ignoreSearch` cache confusion

Artifact: A9.

Primitive:

- Angular Service Worker can serve a query-variant response for a queryless canonical URL when an
  unhashed `resources.urls` asset group uses `cacheQueryOptions.ignoreSearch: true`.

Limits:

- Default hashed CLI assets are protected by manifest hash validation.
- Requires a developer configuration that caches same-origin unversioned resources with
  `ignoreSearch`.

Phase 2 use:

- Search docs/examples/common configs for runtime config JSON or user-influenced same-origin assets
  cached under `ignoreSearch`.

## Refuted Direct Variant Catalog

Do not retest these exact shapes in Phase 1.

| Artifact | Refuted shape | Protective boundary |
|---|---|---|
| A12 | protocol-relative / slash / backslash / whitespace / userinfo / encoded-separator XSRF URL bypasses | `new URL(req.url, locationOrigin)` origin comparison |
| A13 | current direct SSR platform race across concurrent `renderApplication()` requests | request-local `BootstrapContext`, no global server platform injector reuse |
| A14 | late `BEFORE_APP_SERIALIZED` / `TransferState.onSerialize()` cross-request leak | request-local document/provider state in tested standalone and NgModule paths |
| A15 | i18n ResourceURL siblings for `iframe/embed/object` | compiler Trusted Types sink rejection |
| A16 | ICU attr normalization bypasses | `VALID_ATTRS` / `SENSITIVE_ATTRS` allowlist and inert parser normalization |
| A17 | SVG `foreignObject` / MathML namespace sanitizer loss | namespace reset plus generated `sanitize*` / `validateAttribute` calls |

## Phase 1 Closeout Checklist

- [x] All six CVE seeds have a verdict.
- [x] Every confirmed non-reportable primitive has an artifact path.
- [x] The VRP candidate is separated from bounded primitives.
- [x] Direct refuted variants are listed to avoid repeat work.
- [x] Threat model is updated with Phase 1 results.
- [ ] A1 report wording final review.
- [ ] A1 submission decision.

## Do Not Start Yet

Phase 2 should not begin until A1 is either submitted or deliberately parked.

When Phase 2 starts, use this closeout as the primitive catalog and expand by entry point, trust
boundary, high-risk operation, and attacker model rather than by CVE names.
