# V8 Threat Model Reset - Patch-Derived Hunt

**Date:** 2026-04-27
**Target:** V8 14.8.178.9, `209cf3b52af1ac949a6774ccd0b8843958fbab9d`

## Why reset

The original matrix is technically sound but too broad in execution. We are
spending effort on generic surfaces and getting many narrow `REFUTED` PoCs.
That is expected when the candidate is "Wasm canonical types" or "GC marker
race" rather than a concrete fixed root cause.

New rule for the next round:

```text
recent backport / security-looking fix -> exact invariant -> sibling path -> PoC
```

Not:

```text
surface -> 5 generic PoCs -> refuted
```

## Coverage reality

Already probed:

- C13 Temporal: one confirmed spec divergence, sub-VRP.
- C3 late load elimination: many shapes refuted; round closed, no primitive.
- C4 store-store elimination: partial-overlap shape reached and refuted.
- C7 Wasm canonical types: confirmed experimental crash, not Chrome VRP.
- C11 marker race: JS-accessible shared/marker routes refuted.
- C16 RegExp `/v`: first parser slice refuted.
- C6 ObjectIs lowering: mechanical audit refuted.

Conclusion: the old P1 list should not keep driving the next probe. It is now
a coverage ledger, not the active hunt plan.

## Patch-derived signals

### P0 - JSPI suspender EPT UAF sibling

Commit: `bbc81df8069 [M148] [wasm][jspi] Clear suspender EPT entry on unwind`

Root cause:

- Exception/termination unwinds across Wasm stack switching.
- A `WasmSuspenderObject` retained an external pointer table entry to a freed
  `StackMemory`.
- Regression test uses `--sandbox-testing` and documents a freed
  out-of-sandbox `StackMemory*` dereference on resume.

Fix:

- `src/execution/isolate.cc`: when exception escapes current suspender during
  stack unwind, call `suspender->set_stack(this, nullptr)`.

Why high value:

- This is not a logic-only bug. It is UAF-shaped, external-pointer-table shaped,
  and tied to sandbox/stack-switching.
- The test already gives an exploitation-oriented layout:
  `StackMemory` size 184, `jmpbuf.state` at `+68`, `sp/fp/pc` nearby.

Sibling hypotheses:

- Other unwind exits clear `active_stack` but miss `suspender->stack`.
- Termination, promise rejection, thrown JS exception, and uncatchable
  termination may have distinct unwind paths.
- Multiple nested suspenders may clear only the top/current suspender.
- Stack return path was fixed earlier; exception unwind was the sibling. Look
  for the next non-return path.

Next probe:

- New candidate `c19-wasm-jspi-suspender-ept-uaf`.
- Start by copying `test/mjsunit/sandbox/regress-501147587.js` into a local
  PoC and validating it on the fixed target.
- Then mutate one axis at a time: nested suspenders, rejection instead of
  termination, terminate before/after promise resolution, handler in secondary
  stack, worker isolate.

Infra note:

- On this macOS d8 build, `--sandbox-testing` aborts before running the test:
  `The sandbox crash filter is currently only available on Linux`.
- C19 needs a Linux ASAN/sandbox-testing run, or a non-sandbox JSPI sibling that
  demonstrates stale suspender state without the sandbox helper API.

### P0 - Wasm `NativeModule` managed lifetime UAF siblings

Commit: `b6302d64ffd [wasm] Avoid UaF via WasmModuleObject::native_module()`

Root cause:

- Many call sites used raw `NativeModule*` from a `Managed<NativeModule>`.
- Fix changes API to return `Managed<NativeModule>::Ptr`, keeping native module
  alive while used.

Why high value:

- Broad change: debug, inspector, c-api, d8, runtime tests, wasm objects.
- Debug/coverage/inspector paths often run while JS can drop the last module
  reference and force GC.

Sibling hypotheses:

- Any remaining `native_module()` result that becomes raw and survives
  allocation/GC is suspect.
- Debug proxies storing module object/function index in arrays may still allow
  stale `NativeModule` through names/provider paths.
- Inspector/gdb-server/c-api paths may keep non-owning pointers across callbacks.

Next probe:

- Static grep for `NativeModule*` + `native_module()` + debug/inspector/c-api.
- Build JS/debugger-facing repro only if a raw pointer crosses allocation/GC.

### P1 - Wasm shared memory growth race sibling

Commit: `3dfcc338afd [wasm] Fix reset of Wasm memory buffer on shared growth`

Root cause:

- Concurrent `memory.grow(0)` could observe growth performed by another thread
  and incorrectly expect `array_buffer` reset.
- Fix changes reset check from byte length comparison to `pages > 0`.

Why high value:

- Race, shared memory, workers, buffer object state.
- Regression reproduced before fix in over 10% of runs.

Sibling hypotheses:

- Other shared-memory metadata refresh paths still use observed byte-length
  deltas instead of "this thread grew".
- `memory.buffer` cache state, resizable flag, and `Managed<BackingStore>` size
  updates may diverge under concurrent grow.

Next probe:

- New candidate `c20-wasm-shared-memory-grow-race`.
- Start from `test/mjsunit/regress/wasm/regress-493905761.js`.
- Mutate: more workers, `grow(0)`/`grow(1)` reorder, repeated `memory.buffer`
  identity checks, resizable shared memory if exposed, worker termination during
  grow.

Local validation:

- The upstream regression passes on the current macOS release d8, so the target
  includes the direct fix. C20 should probe siblings, not the exact fixed bug.

### P1 - Turbolev `instanceof` wrong guard

Commit: `40999af682a [M148] [turbolev] Fix wrong guard in TryBuildFastInstanceOf`

Root cause:

- Lowering proceeded in a path where `@@hasInstance` data property was callable
  but not a `JSFunction`, or call reduction was unavailable.
- Fix aborts earlier if the reducer cannot build a call and requires
  `has_instance_field` to be `JSFunction`.

Regression shape:

- Object with custom `Symbol.hasInstance`.
- `try/catch` path feeds `instanceof` through OSR.
- `%OptimizeOsr()` inside loop.

Sibling hypotheses:

- Other Maglev/Turbolev reducers assume "callable" implies "JSFunction".
- Other symbol hooks (`@@toPrimitive`, iterator, species, match/search/split)
  may use same weak guard.
- Proxy callable / bound function / revoked proxy variants may pass
  "callable" checks and fail later lowering assumptions.

Next probe:

- New candidate `c21-turbolev-callable-not-jsfunction`.
- Diff grep for `.map(broker()).is_callable()` and `IsJSFunction()` in
  Maglev/Turbolev reducers.

### P1 - Maglev context cell race

Commit: `84d215bb970 [maglev] Fix context cell race`

Root cause:

- Maglev specialized a context cell when value was not ready at compile time.
- Fix changes fallback: if `ContextCell::kConst` has no `tagged_value`, return
  no specialization instead of loading as no-cell context slot.

Why high value:

- Race between compile-time observation and runtime context initialization.
- This is exactly the "stale compiler assumption" class that keeps landing.

Sibling hypotheses:

- Other context-cell states (`kSmi`, `kInt32`, `kFloat64`, `kDetached`) may have
  stale state/value pairing under OSR or closure initialization.
- Function-context cells and script-context cells may differ.

Next probe:

- New candidate `c22-maglev-context-cell-race`.
- Generate closures/modules where const/let/function-context cells are read
  during OSR before initialization, with eval/try/catch to delay readiness.

### P2 - Wasm Fast API c-function/signature atomicity

Commit: `ef2143b7e2b [wasm] Read c-function and signature atomically`

Root cause:

- In-sandbox corruption could race C function address and signature reads so
  they became out of sync.
- Fix returns `CFunctionWithSignature` as one object instead of separate address
  and signature reads.

Why not first:

- Likely needs sandbox-testing or an existing in-sandbox write primitive.
- Still useful as sandbox bypass/follow-on.

### P2 - 32-bit int64 lowering invalid offset

Commit: `649b1d7552b [M148] [wasm] 32 bit platforms: Fix int64 lowering for
'invalid' offsets`

Root cause:

- 32-bit lowering split 64-bit loads/stores and mishandled the singular invalid
  offset value when adding the second 32-bit half offset.

Why not first:

- Current machine is macOS arm64, not 32-bit.
- Keep as cross-arch candidate only if we can run ia32/x86 simulator or build.

## New priority order

1. `c19-wasm-jspi-suspender-ept-uaf`
2. `c20-wasm-shared-memory-grow-race`
3. `c21-turbolev-callable-not-jsfunction`
4. `c22-maglev-context-cell-race`
5. `c23-wasm-native-module-managed-lifetime`
6. `c24-wasm-fastapi-signature-atomicity`
7. `c25-wasm-int64-invalid-offset-32bit`

## Stop conditions for this reset

- Do not close a new candidate until at least one exact regression shape and
  one sibling mutation were tested.
- Do not spend more than one round on broad stress. If regression-shape sibling
  does not produce signal, patch-diff next sibling.
- Prefer tests already landed in V8 over invented fuzzing.
