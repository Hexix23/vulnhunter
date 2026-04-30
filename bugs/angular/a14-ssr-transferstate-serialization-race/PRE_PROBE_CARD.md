# A14 - GHSA-68x2 sibling: SSR TransferState / BEFORE_APP_SERIALIZED race

Target: `targets/angular`

Phase: CVE-derived sibling candidate

Prior CVE class: SSR race / cross-request state leak.

Advisory/fix source:
- GHSA-68x2-mx4q-78m7 / CVE-2025-59052.
- Fix lineage: `BootstrapContext` and server-mode global platform isolation.

Invariant: Request-local SSR state must not cross concurrent render requests during late serialization hooks.

Entry point: `renderApplication()` / `renderModule()` with `BEFORE_APP_SERIALIZED` callbacks and `TransferState`.

Trust boundary: Concurrent SSR requests with different `DOCUMENT`, `SERVER_CONTEXT`, platform providers, and transfer-state values.

High-risk operation:
- `renderInternal()` awaits all `BEFORE_APP_SERIALIZED` callbacks just before `platformState.renderToString()`.
- `serializeTransferStateFactory()` injects `DOCUMENT` and `TransferState`, calls `transferStore.toJson()`, creates a script using the injected document, and appends it to `doc.body`.
- `TransferState.onSerialize()` callbacks run during `toJson()`.

Attacker model: Remote SSR clients can trigger concurrent renders with different request-local state. Application code uses documented `BEFORE_APP_SERIALIZED` or `TransferState.onSerialize` hooks.

Sink: Serialized HTML response, especially `<script id="ng-state" type="application/json">...</script>`.

Attacker-controlled value: Request-local secret/provider/document marker that is serialized into TransferState.

Expected violation:
- H1: Async `BEFORE_APP_SERIALIZED` callback in render A appends or serializes into render B's document.
- H2: `TransferState.onSerialize` callback in render A reads B's `DOCUMENT` marker or provider value under concurrent interleaving.
- H3: `renderModule()` long-form/NgModule path diverges from standalone `renderApplication()` and leaks request state.

Canonical runtime: Angular's own `packages/platform-server/test:test` framework runtime.

Oracle:
- Render A HTML must contain only A transfer-state values and document marker.
- Render B HTML must contain only B transfer-state values and document marker.
- Both standalone `renderApplication()` and NgModule `renderModule()` should satisfy the same invariant.

Reportability bar: VRP candidate if current ordinary Angular SSR APIs can serialize request B's secret into request A's HTML response, without custom global state in application code.

Stop condition: If both standalone and NgModule paths isolate `DOCUMENT`, `TransferState`, and async serialization hooks under concurrency, close this sibling and return to remaining Phase 1 queue/Phase 2 planning.
