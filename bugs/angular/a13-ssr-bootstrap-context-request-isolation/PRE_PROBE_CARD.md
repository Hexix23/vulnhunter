# A13 - GHSA-68x2-mx4q-78m7 SSR BootstrapContext request isolation

Target: `targets/angular`

Phase: CVE-derived

Prior CVE class: SSR race / cross-request state leak.

Advisory/fix source:
- GHSA-68x2-mx4q-78m7 / CVE-2025-59052.
- Angular PR #63562.
- Angular CLI PR #31108 updates generated server bootstrap code to pass `BootstrapContext`.
- Local fix lineage includes `28926ba92c`, `70d0639bc1`, `9d1fb33f5e`, `6117ccee2e`.

Fix diff files:
- `packages/core/src/platform/platform.ts`
- `packages/core/src/application/create_application.ts`
- `packages/platform-browser/src/browser.ts`
- `packages/platform-server/src/server.ts`
- `packages/platform-server/src/utils.ts`
- migration files for server `main.server.ts`

Invariant: SSR request-specific platform providers, document, URL, and platform state must be scoped to the individual render request and must not be read from or written through module-global platform state.

Entry point: `renderApplication()` / `renderModule()` and app bootstrap functions used by Angular SSR.

Trust boundary: Concurrent remote SSR requests with different request-local providers and documents.

High-risk operation: Platform creation/reuse, `BootstrapContext`, global `_platformInjector`, global Ivy `DOCUMENT` via `ɵsetDocument`, application bootstrap async boundaries, `whenStable()`, and platform destruction.

Attacker model: Remote unauthenticated SSR clients can send concurrent requests that differ in URL, request providers, or other per-request state; the app uses ordinary Angular SSR APIs.

Sink: Rendered HTML response, serialized `TransferState`, platform providers, `DOCUMENT`, `PlatformState`, `SERVER_CONTEXT`, and cleanup/destruction.

Attacker-controlled value: Request-local platform provider value and/or document marker.

Expected violation:
- H1: `renderApplication()` with proper `BootstrapContext` still leaks request-local platform provider values under concurrent renders.
- H2: adjacent global `ɵsetDocument(document)` can cause render A to read or serialize render B's document under a controlled async bootstrap window.
- H3: legacy bootstrap functions that ignore `BootstrapContext` fail closed instead of silently falling back to a shared/global platform.

Canonical runtime: Angular's own `packages/platform-server/test:integration` target first. Promote to compiled SSR app only if a framework-level race is confirmed.

Oracle:
- Concurrent renders of A and B must each return only their own token/document marker.
- Old-style `bootstrapApplication(App, config)` during server rendering should reject with the explicit missing `BootstrapContext` error.
- `getPlatform()` should be null during/after server rendering and should not expose request platforms.

Reportability bar: VRP candidate only if ordinary current Angular SSR APIs can leak request-local data across concurrent requests or silently run with the wrong request platform. A legacy app that no longer boots and fails closed is not reportable.

Stop condition: If proper `renderApplication()`/`renderModule()` are isolated, global document does not affect rendered output in tested realistic paths, and legacy bootstrap fails closed, close the CVE seed and move to Phase 1 completion.
