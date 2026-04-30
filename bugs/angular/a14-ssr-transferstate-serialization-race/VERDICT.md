# A14 - SSR TransferState / BEFORE_APP_SERIALIZED serialization race

IMPACT_CLASS: SECURITY_LOGIC

VERDICT: REFUTED_CURRENT_SIBLING_RACE

One-line reason: Concurrent standalone and NgModule SSR renders with async `BEFORE_APP_SERIALIZED` hooks plus `TransferState.onSerialize()` kept request-local document markers and secrets isolated.

## Why this sibling matters

This candidate stays inside the GHSA-68x2 invariant. The original class is cross-request SSR state leakage. A13 covered the main `BootstrapContext` path for platform providers and `DOCUMENT`; A14 covers the late serialization path where state is written directly into the returned HTML.

Relevant source:

- `packages/platform-server/src/utils.ts:195-218`: `renderInternal()` runs and awaits `BEFORE_APP_SERIALIZED` callbacks immediately before `platformState.renderToString()`.
- `packages/platform-server/src/transfer_state.ts:70-109`: `serializeTransferStateFactory()` injects request `DOCUMENT` and `TransferState`, calls `toJson()`, creates a script with the injected document, and appends it to `doc.body`.
- `packages/core/src/transfer_state.ts:121-146`: `TransferState.onSerialize()` callbacks run during `toJson()` and write values into the store.

## Probe

Temporary framework test added to `packages/platform-server/test/integration_spec.ts`.

The probe defines:

- request-local token `A14_REQUEST_SECRET`,
- transfer state key `a14-secret`,
- component constructor registering:

```ts
transferState.onSerialize(A14_STATE_KEY, () => {
  return `${secret}|${doc.body.getAttribute('data-a14')}`;
});
```

- async `BEFORE_APP_SERIALIZED` callback that waits and then writes:

```ts
doc.body.setAttribute('data-a14-hook', doc.body.getAttribute('data-a14') ?? '');
```

It runs two concurrent SSR renders for both standalone `renderApplication()` and NgModule `renderModule()`:

```text
Render A: document body data-a14="doc-A", platform provider secret-A
Render B: document body data-a14="doc-B", platform provider secret-B
```

Assertions:

- output A contains `data-a14="doc-A" data-a14-hook="doc-A"`,
- output A contains `"a14-secret":"secret-A|doc-A"`,
- output A does not contain `secret-B` or `doc-B`,
- output B contains `data-a14="doc-B" data-a14-hook="doc-B"`,
- output B contains `"a14-secret":"secret-B|doc-B"`,
- output B does not contain `secret-A` or `doc-A`.

Command:

```bash
bazelisk --output_user_root=/tmp/vulnhunter-bazel-user test //packages/platform-server/test:test --test_filter='A14 probe'
```

Result: passed.

Evidence:

- `poc/a14_transferstate_serialization_race_probe.patch`
- `evidence/2026-04-29-platform-server-a14-transferstate-race.log`

## Reportability

No new report candidate from A14.

The tested late-serialization sibling path did not leak cross-request secrets or document state in current Angular. This meaningfully improves coverage for GHSA-68x2 because it covers a realistic, security-sensitive sink: serialized HTML/TransferState.

## Remaining adjacent risk

The remaining worthwhile sibling areas are narrower:

- direct/manual `platformServer()` long-form usage where an application intentionally holds a platform across requests,
- non-standard private APIs such as `ɵrenderInternal`,
- app-level module globals in user code, which are outside framework ownership unless Angular docs/scaffold encourage them.

Those should not be treated as current framework findings unless we can show ordinary Angular-provided scaffolding reaches them.
