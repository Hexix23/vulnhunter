# Angular Framework Invariants And Sink Matrix

Date: 2026-04-28
Target: `targets/angular`
Basis: fresh source inventory plus the 2025-2026 Angular advisory seed set. Previous Angular threat-model files were deleted and not reused.

## Anti-Anchoring Gate

The CVEs are seed contracts, not the hunt boundary. The first probing batch must satisfy:

- <= 40% direct variants of the listed CVEs.
- >= 25% non-i18n / non-sanitizer surfaces.
- >= 25% state, cache, or concurrency bugs.
- >= 15% under-explored framework corners such as service worker, image loaders, router navigation interception, hydration, or JIT resource loading.

## Surface S1: SSR URL Origin Reconstruction

Files:
- `packages/platform-server/src/location.ts:27-32`
- `packages/platform-server/src/location.ts:56-68`
- `packages/platform-server/src/http.ts:44-63`
- `packages/platform-server/src/tokens.ts`

Invariant:
- `INITIAL_CONFIG.url` that represents an incoming path must stay path-only relative to the real server origin. It must not become attacker origin after URL normalization.
- Server-side relative `HttpClient` rewrites must use a trusted origin and base href.

Sinks:
- `new URL(urlToParse)` in platform location.
- `new URL(request.url, baseUrl)` in server HTTP interceptor.
- `PlatformLocation.hostname`, `href`, `protocol`, and `getBaseHrefFromDOM()`.

Expansion probes:
- Leading `//`, `/\`, `\\`, `%2f%2f`, `%5c`, mixed slashes, Unicode slash-like code points.
- Malformed base href and `<base href>` interactions.
- Absolute request URL passed to `renderApplication` or `renderModule`.
- SSR apps using relative `HttpClient` calls to internal APIs.

Candidate A1:
- Demonstrate whether any encoded or base-href variant still hijacks `ServerPlatformLocation.hostname` or server `HttpClient` target after the known backslash/protocol-relative fix.

Status note:
- Initial probing found `http:///attacker.test/path`. Node exposes it as `req.url`, and Angular
  `parseUrl()` / `ServerPlatformLocation` normalize it to `http://attacker.test/path`.
- This is a stronger candidate than A4 because it can feed the server-side relative `HttpClient`
  rewrite path. Full SSR app confirmation is still pending.

## Surface S2: XSRF Same-Origin Classification

Files:
- `packages/common/http/src/xsrf.ts:93-126`
- `packages/common/http/src/fetch.ts:312-346`
- `packages/common/http/src/xhr.ts:156-161`

Invariant:
- XSRF header attachment requires canonical origin equality between current page and request URL.
- Invalid, opaque, protocol-relative, backslash-normalized, or non-HTTP URLs must not receive tokens.

Sinks:
- `new URL(locationHref)` and `new URL(req.url, locationOrigin)` in `xsrfInterceptorFn`.
- `withCredentials` / `credentials` propagation to fetch/XHR backends.

Expansion probes:
- `//host`, `http:\host`, `https:/\host`, encoded authority separators, username/password, default ports, IPv6, mixed-case schemes.
- Same-origin absolute URLs with path confusion.
- Custom `PlatformLocation.href` from tests/server/domino.
- Interaction with `withCredentials: true` and explicit `credentials`.

Candidate A2:
- Find a URL form for which browser/fetch targets an attacker origin but `xsrfInterceptorFn` computes same-origin, or vice versa for a security-relevant credential behavior.

Status note:
- A2 expansion produced A8: XSRF relative URL classification ignores document `<base href>`.
- Chrome resolves both `fetch('api')` and `fetch('/root-api')` against a cross-origin base href.
- Angular XSRF classifies `api`, `/api`, `./api`, and `../api` against `location.origin` and adds
  `X-XSRF-TOKEN`.
- Impact is chain-required: attacker must control or influence cross-origin base href and CORS must
  allow the XSRF header for the token to be disclosed.

## Surface S3: DOM Security Schema Completeness

Files:
- `packages/compiler/src/schema/dom_security_schema.ts:29-164`
- `packages/compiler/src/schema/dom_element_schema_registry.ts`
- `packages/compiler/src/template/pipeline/src/phases/resolve_sanitizers.ts:54-75`
- `packages/core/src/sanitization/sanitization.ts:235-258`

Invariant:
- Every URL, resource URL, HTML, style, script, and attribute-indirection sink must map to the correct sanitizer or runtime validator.
- Multi-context properties must not downgrade to `SecurityContext.NONE`.

Sinks:
- `SecurityContext.URL`, `RESOURCE_URL`, `HTML`, `STYLE`, `ATTRIBUTE_NO_BINDING`.
- `ɵɵsanitizeUrlOrResourceUrl(unsafeUrl, tag, prop)`.
- `validateAttribute` path for `attributeName`, `to`, `from`, `values`, iframe sensitive attrs.

Expansion probes:
- SVG: `use`, `image`, `script`, `foreignObject`, animation elements.
- MathML: href-bearing elements in the schema list plus less common attributes not in list.
- Host bindings where tag is unknown at compile time.
- Custom elements with dangerous attribute names and namespace prefixes.
- Property-vs-attribute aliases such as `formAction`, `srcdoc`, `xlink:href`, `innerHTML`.

Candidate A3:
- Differential compile generated code for template bindings vs host bindings to identify any security context mismatch for the same browser sink.

## Surface S4: Runtime i18n Attribute And ICU DOM Creation

Files:
- `packages/core/src/render3/i18n/i18n_parse.ts:357-392`
- `packages/core/src/render3/i18n/i18n_parse.ts:781-843`
- `packages/core/src/sanitization/html_sanitizer.ts:71-127`
- `packages/core/src/render3/i18n/i18n_postprocess.ts`

Invariant:
- i18n attributes with interpolations must preserve the sanitizer associated with the original attribute.
- Translated ICU content must not introduce URI-bearing static attributes; bound URI attributes must be sanitized.
- Runtime i18n must not create elements or attributes outside the sanitizer allowlist.

Sinks:
- `generateBindingUpdateOpCodes(..., attrName, ..., sanitizeFn)`.
- `VALID_ELEMENTS`, `VALID_ATTRS`, `SENSITIVE_ATTRS`.
- ICU-created element/attribute create opcodes.

Expansion probes:
- Attribute name case folding and namespace aliases.
- `i18n-*` attributes on `form`, `button`, `input`, `object`, SVG/MathML-like elements.
- ICU nested elements with placeholders adjacent to dangerous attributes.
- Translation files introducing static `href`, `src`, `action`, `formaction`, `data`, `codebase`.
- Interaction between i18n and hydration skip/projection paths.

Candidate A4:
- Find any translated attribute path where `SENSITIVE_ATTRS` lookup misses the real DOM sink due to aliasing, namespace, case, property mapping, or form-specific attributes.

Status note:
- A4 produced a confirmed `link|href` ResourceURL downgrade through direct `i18n-href`.
- Default-app browser validation confirmed remote `stylesheet`, `preload`, and `modulepreload`
  fetches, but no JavaScript execution. Static `rel=stylesheet` is blocked at build time by
  Angular stylesheet resolution.
- A15 expanded the same invariant across `RESOURCE_URL` siblings. `iframe|src`, `embed|src`,
  `object|data`, and `object|codebase` are compiler-rejected through the Trusted Types sink guard;
  `frame|src`, `base|href`, and script URL attrs did not emit a usable DOM attribute in the
  framework acceptance runtime.
- Treat this as a chain primitive, not as a standalone high-impact bug. The refined invariant is
  that runtime i18n sanitizer selection must preserve full `tag|attr` context, not only attribute
  name.

Candidate A10/A16:
- A10 confirmed ICU-created `img[srcset]` preservation, bounded to browser-managed image selection.
- A16 refuted parser-normalization bypasses for uppercase, whitespace-before-equals, null-byte,
  entity-spelled attr names, uppercase `xlink:href`, `style`, `iframe/srcdoc`, and SVG
  parser-mutation shapes.
- A16 browser validation showed `picture/source[srcset]` and `img[srcset]` produce image fetches
  only; a `javascript:` candidate in `srcset` did not execute in Chrome 147.
- Treat `GHSA-prjf-86w9-mfqv` as closed for Phase 1 unless a new non-`srcset` ICU-created
  executable sink is discovered.

Candidate A11/A17:
- A11 confirmed an SVG compiler hardening gap for `use/image/mpath href` and `animate[by]`, but
  Chrome 147 only produced inert image-like fetches and no `javascript:`/external SVG script
  execution.
- A17 tested namespace transitions. SVG `foreignObject` descendants compile in HTML namespace and
  keep `sanitizeUrl`, `sanitizeHtml`, `sanitizeStyle`, and `validateAttribute`; MathML
  `semantics/maction href` keeps `sanitizeUrl`; `annotation-xml` fails closed in the tested normal
  template shape.
- Treat `GHSA-v4hv-rgfq-gp49` as closed for Phase 1 unless a browser behavior change turns the A11
  SVG fetch primitive into script/content execution.

## Surface S5: HTML Sanitizer Allowlist

Files:
- `packages/core/src/sanitization/html_sanitizer.ts:71-127`
- `packages/core/src/sanitization/html_sanitizer.ts:190-210`
- `packages/platform-browser/src/security/dom_sanitization_service.ts:171-205`

Invariant:
- HTML sanitizer must allow only inert HTML elements and must sanitize all allowed URI attributes.
- SVG and MathML remain intentionally unsupported for `innerHTML`.

Sinks:
- `DomSanitizer.sanitize(SecurityContext.HTML, value)`.
- `_sanitizeHtml` inert body parsing and serialization.
- `_sanitizeUrl` for `URI_ATTRS`.

Expansion probes:
- Mutation-XSS via inert parser differences, optional tag closing, entities, malformed attributes, `<template>`, `<noscript>`, and DOM clobbering.
- `srcset`, CSS URL, `data:` image behavior, form-related attributes.
- Domino/server sanitizer behavior vs browser sanitizer behavior.

Candidate A5:
- Compare sanitized output across browser DOM and server DOM adapter for malformed HTML that could reparse into scriptable DOM in one environment.

## Surface S6: SSR Platform / Injector State Isolation

Files:
- `packages/core/src/platform/platform.ts:29-58`
- `packages/core/src/platform/platform.ts:137-165`
- `packages/platform-browser/src/browser.ts:123-171`
- `packages/platform-server/src/utils.ts:135-143`
- `packages/platform-server/src/server.ts`

Invariant:
- In server mode, platform state must be request-local and passed explicitly through `BootstrapContext`.
- `getPlatform()` and `destroyPlatform()` must not expose or mutate another request's platform.
- Async bootstrap/JIT resource loading must not create a race window where request A's platform providers are used by request B.

Sinks:
- module-scoped `_platformInjector`.
- `bootstrapApplication(..., context)`.
- `resolveJitResources()` async boundary.
- `SERVER_CONTEXT` and rendered `ng-server-context` attribute.

Expansion probes:
- Concurrent cold-start requests with different request-scoped tokens.
- JIT-enabled SSR, lazy resource loading, rejected resource promises.
- Custom bootstrap wrappers that ignore `BootstrapContext`.
- NgModule vs standalone SSR.

Candidate A6:
- Build a concurrent SSR harness that renders two request-local secrets and checks response cross-contamination under cold start and JIT resource delay.

## Surface S7: TransferState And HTTP TransferCache

Files:
- `packages/common/http/src/transfer_cache.ts:50-55`
- `packages/common/http/src/transfer_cache.ts:126-143`
- `packages/common/http/src/transfer_cache.ts:253-282`
- `packages/common/http/src/transfer_cache.ts:322-340`
- `packages/common/http/src/transfer_cache.ts:476-499`
- `packages/platform-server/src/transfer_state.ts:40-104`

Invariant:
- TransferCache must not serialize auth-dependent, per-user, or cross-origin-confused responses unless explicitly configured.
- Cache keys must distinguish method, response type, mapped URL, body, and params without attacker-controlled collisions or ambiguity.
- `HTTP_TRANSFER_CACHE_ORIGIN_MAP` must not allow path injection or origin confusion.

Sinks:
- `includePostRequests`, `includeRequestsWithAuthHeaders`, `includeHeaders`.
- `makeCacheKey()` hash over joined string fields.
- `mapRequestOriginUrl()` and `verifyMappedOrigin()`.
- server `<script type="application/json">` transfer-state serialization.

Expansion probes:
- Delimiter collision in `makeCacheKey` fields (`|`, sorted params, serialized body).
- POST cache with attacker-controlled body/params.
- Origin map values with encoded paths, credentials, punycode, default ports.
- Header inclusion of `set-cookie`, auth tokens, tenant IDs, cache-control.

Candidate A7:
- Search for a cache-key collision or origin-map ambiguity that lets one request hydrate another request's response body or headers.

Status note:
- A7 produced confirmed `HttpTransferCache` key confusion in modern Angular.
- Default GET case: `/query?a=1,2` and `/query?a=1&a=2` are different HTTP requests but both
  key as `GET|json|/query||a=1,2` because `sortAndConcatParams()` interpolates
  `params.getAll(k)` with array-to-string comma coercion.
- Browser hydration confirmation: a server-side response cached for `/query?a=1,2` was reused
  by a hydrated browser request for `/query?a=1&a=2`; the backend was not hit.
- Opt-in POST case: `/api|x` body `y` and `/api` body `x|y` collide because
  `makeCacheKey()` joins raw fields with `|`.
- `URLSearchParams` body value multiplicity was refuted through the real interceptor path.
- Current impact is response integrity confusion. Reportability looks plausible for the default
  GET variant, but final severity needs an app-level chain where repeated-vs-comma query
  semantics affect sensitive data or authorization decisions.

## Surface S8: Router URL Parser And Navigation Interception

Files:
- `packages/router/src/url_tree.ts`
- `packages/router/src/statemanager/navigation_state_manager.ts:65-69`
- `packages/router/src/statemanager/navigation_state_manager.ts:540-543`
- `packages/router/src/directives/router_link.ts`

Invariant:
- Router URLs are application-internal unless explicitly external; protocol-relative and multi-leading-slash forms must not become cross-origin navigations while still being treated as router-owned.
- Navigation interception must compare canonical URLs with correct base origin.

Sinks:
- router parse/serialize URL tree.
- `new URL(routerDestination, eventDestination.origin)` comparison.
- `RouterLink` `href` generation.

Expansion probes:
- Multiple leading slashes, matrix params, encoded slashes, backslashes, fragment tricks.
- `browserUrl` extras and `RedirectCommand`.
- Navigation API precommit redirects.

Candidate A8:
- Find a URL form that router serializes as internal but browser interprets as external, or that bypasses navigation interception origin checks.

## Surface S9: Service Worker URL Normalization And Cache Matching

Files:
- `packages/service-worker/worker/src/adapter.ts:78-97`
- `packages/service-worker/worker/src/assets.ts`
- `packages/service-worker/worker/src/data.ts`
- `packages/service-worker/worker/src/driver.ts`
- `packages/service-worker/config/src/generator.ts`

Invariant:
- Service worker cache matching must preserve origin and query boundaries, and generated manifest patterns must not overmatch attacker-controlled URLs.

Sinks:
- `Adapter.normalizeUrl()`.
- asset/data group matching.
- notification `onActionClick.url` open handling.
- manifest generation from glob patterns.

Expansion probes:
- Cross-origin URLs normalized into path-only form.
- `ignoreSearch` cache query options.
- Glob-to-regex overmatching.
- Mixed HTTP/HTTPS scope handling.
- navigation fallback and opaque responses.

Candidate A9:
- Construct manifest patterns and requests that cause attacker-controlled or user-specific responses to be cached under a public URL key.

Status 2026-04-28:
- Confirmed chain primitive in `bugs/angular/a9-sw-ignoresearch-query-cache-poisoning/`.
- Angular SW strips query during same-origin asset routing (`Adapter.normalizeUrl()`), but Cache API lookup can ignore query and `cache.put()` stores the original request URL.
- Browser-confirmed with real built `ngsw-worker.js`: `/runtime-config.json?attacker` can populate an unhashed `ignoreSearch` asset cache entry later served for `/runtime-config.json` with no second network request.
- Not default-exploitable for hashed CLI assets; reportability depends on finding scalable/common `resources.urls` + `ignoreSearch` runtime-config patterns.

## Surface S10: Image Loader And Preconnect Origin Parsing

Files:
- `packages/common/src/directives/ng_optimized_image/url.ts`
- `packages/common/src/directives/ng_optimized_image/preconnect_link_checker.ts`
- `packages/common/src/directives/ng_optimized_image/image_loaders/*`

Invariant:
- Image loader and preconnect helpers must not misparse attacker-controlled URLs into trusted origins or generate misleading resource hints.

Sinks:
- `new URL(src)` / `new URL(src, win.location.href)`.
- CDN loader path concatenation.
- preconnect origin blocklist.

Expansion probes:
- Protocol-relative URLs, credentials in URL, encoded host separators, path-based CDN loader escapes, localhost blocklist bypasses.

Candidate A10:
- Identify image-loader URL rewriting that turns app-controlled image paths into attacker-selected absolute origins while warnings/preconnect logic treats them as trusted.

## First Hunt Batch

Recommended order:

1. A3/A4: compiler/i18n sanitizer mismatches, because three CVEs cluster here and current source has many schema-driven assumptions.
2. A1/A2: URL origin and credential classification, because SSRF/XSRF fixes share parser-mismatch roots.
3. A7: TransferCache leakage, because it expands from SSR race into cache-state impact.
4. A9: service worker URL/cache normalization, to force expansion outside the known CVE cluster.
5. A8/A10: router and image URL parsing as lower-cost parser transfer probes.
