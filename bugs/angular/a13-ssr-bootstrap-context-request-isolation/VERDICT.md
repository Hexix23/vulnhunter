# A13 - GHSA-68x2-mx4q-78m7 SSR BootstrapContext request isolation

IMPACT_CLASS: SECURITY_LOGIC

VERDICT: REFUTED_CURRENT_DIRECT_RACE / PROTECTIVE_FIX_CONFIRMED

One-line reason: Current `renderApplication()` with `BootstrapContext` keeps concurrent request-local platform providers and documents isolated, and legacy server bootstrap that ignores `BootstrapContext` fails closed instead of silently using a shared platform.

## Prior CVE contract

GHSA-68x2-mx4q-78m7 / CVE-2025-59052 is a cross-request SSR leak class: module/global platform state must not carry request-specific providers, document, URL, or cache state across concurrent server renders.

Local fix lineage:

- `28926ba92c` / PR #63562 introduced `BootstrapContext` and changed server standalone rendering to call `bootstrap({platformRef})`.
- `packages/core/src/platform/platform.ts` no longer stores `_platformInjector` while `ngServerMode` is true.
- `packages/core/src/application/create_application.ts` throws if server-mode `bootstrapApplication()` is called without a `platformRef`.
- `packages/platform-browser/src/browser.ts` accepts `BootstrapContext` for `bootstrapApplication()` and `createApplication()`.
- `packages/platform-server/src/utils.ts` creates a platform per render and passes it explicitly into the bootstrap callback.

## Source findings

Protective code paths:

- `packages/core/src/platform/platform.ts:38-58`: `createPlatform()` sets `_platformInjector = null` in server mode.
- `packages/core/src/platform/platform.ts:142-147`: `getPlatform()` returns `null` in server mode.
- `packages/core/src/platform/platform.ts:172-193`: `createOrReusePlatformInjector()` does not cache a platform injector in server mode.
- `packages/core/src/application/create_application.ts:47-54`: server-mode application creation rejects when no `platformRef` is supplied.
- `packages/platform-server/src/utils.ts:331-350`: `renderApplication()` creates a request platform and calls `bootstrap({platformRef})`, then destroys the platform.
- `packages/platform-server/src/utils.ts:271-290`: `renderModule()` also creates and destroys a per-render platform.

Adjacent code reviewed:

- `packages/platform-server/src/server.ts:94-111` still calls `ɵsetDocument(document)` when resolving the request document. This is global Ivy state, so it is a valid sibling concern under the same request-isolation invariant.
- The realistic render path tested below reads `DOCUMENT` through DI and renders through the request platform. No document marker leak was observed under concurrent renders.

## Runtime probe

Temporary framework test added to `packages/platform-server/test/integration_spec.ts`:

1. Creates an `A13_REQUEST_SECRET` platform token.
2. Defines a standalone component that renders:

```ts
secret = inject(REQUEST_SECRET);
docMarker = inject(DOCUMENT).body.getAttribute('data-a13');
```

3. Adds a small async `APP_INITIALIZER` delay to widen the interleaving window.
4. Runs two `renderApplication()` calls concurrently:

```ts
render A: document data-a13="doc-A", platform provider secret-A
render B: document data-a13="doc-B", platform provider secret-B
```

5. Asserts:

- output A contains `secret=secret-A doc=doc-A`,
- output A does not contain `secret-B` or `doc-B`,
- output B contains `secret=secret-B doc=doc-B`,
- output B does not contain `secret-A` or `doc-A`.

The same temporary test also checks old-style server bootstrap:

```ts
renderApplication(() => bootstrapApplication(A13LegacyApp, APP_CONFIG), ...)
```

Expected and observed: rejected with `/Missing Platform/`.

Command:

```bash
bazelisk --output_user_root=/tmp/vulnhunter-bazel-user test //packages/platform-server/test:test --test_filter='A13 probe'
```

Result: passed.

Evidence:

- `poc/a13_platform_server_isolation_probe.patch`
- `evidence/2026-04-29-platform-server-a13-isolation.log`

## Relationship to A7

A7 remains separate. It is not the same race fixed by GHSA-68x2; it is a TransferCache key collision primitive inside SSR/hydration state. Keep it catalogued as `CONFIRMED-RESPONSE-CONFUSION`, but do not treat it as a bypass of `BootstrapContext`.

## Reportability

No new report candidate from A13.

The current framework behavior closes the direct race class tested here:

- current canonical `renderApplication()` isolates concurrent request-local provider/document state,
- stale/legacy bootstrap fails closed,
- `getPlatform()` no longer exposes a server request platform.

Residual review point: the global Ivy document setter remains a sensitive adjacent state surface. It did not produce a leak in the realistic render path tested here, but it should stay in the threat model for Phase 2 if we later examine non-standard codegen/private-instruction paths or sanitizer fallback paths without an injected sanitizer.
