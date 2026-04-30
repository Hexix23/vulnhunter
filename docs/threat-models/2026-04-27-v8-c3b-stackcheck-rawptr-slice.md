# V8 C3b Slice - StackCheck x Raw Pointer Reuse

**Date:** 2026-04-27
**Candidate:** `C3b.S2`
**Surface:** Turboshaft late load elimination around `JSStackCheck` / `WasmStackCheck`
**Violated contract:** A raw pointer or external resource pointer derived from a movable heap object must not be reused across a stack-check interrupt that can run full GC unless the pointer is recomputed from an updated tagged root or the pointed resource is otherwise pinned/retained.

## Why C3 stays open

The previous C3 probes refuted specific JS shapes, not the reducer-level concern.

- `late-load-elimination-reducer.cc:260-275` exempts `JSStackCheck` and `WasmStackCheck` from invalidation.
- `operations.h:3763-3785` says `JSStackCheckOp::Kind::kLoop` can read heap memory and allocate.
- `runtime-test.cc:1248-1257` confirms `%ScheduleGCInStackCheck()` requests a full GC on the next stack-check interrupt.
- `h4-loadelim-trace.txt` and `h6-loadelim-trace.txt` show typed-array field loads reused across loop stack checks.

## Correction to the prior typed-array reasoning

The build defines `V8_TYPED_ARRAY_MAX_SIZE_IN_HEAP=64`, so small `new Int32Array(2)` values are on-heap initially. The old explanation "ordinary JS-created typed arrays are off-heap" was too broad.

New probe:

- `bugs/v8/c3-turboshaft-loadelim/poc/h6-onheap-typedarray-store-stackcheck.js`

Result:

- ASan + release both return `OK`, including `--compact-on-every-full-gc`.
- The trace shows `JSTypedArrayBasePointer` / `JSTypedArrayExternalPointer` field loads reused across `JSStackCheck(loop)`.
- This shape appears protected because the reused base is still a tagged object value that the safepoint can update; the raw data pointer is rebuilt from updated tagged base plus external offset.

## Current suspicious sibling class

Keep looking for values with all of these properties:

1. Produced from a heap object before a loop stack check.
2. Represented as `WordPtr` / external resource pointer, not a tagged root.
3. Used by a `Load` / `Store` after `JSStackCheck` or `WasmStackCheck`.
4. Not guarded by `NotLoadEliminable()` or an effective `Retain(...)` placement.

## High-signal code paths

1. **Wasm string character access**
   - `wasm-lowering-reducer.h:610-637`
   - `wasm/turboshaft-graph-interface.cc:6218-6332`
   - Sequential strings use `BitcastTaggedToWordPtr(base)` plus raw immutable loads.
   - External strings use `LoadExternalPointerFromObject(...)` and then raw loads from the resource pointer.
   - Callers add `Retain(string)` after the final access, but the thing to verify is whether a loop `WasmStackCheck` can sit between pointer derivation and use or let load elimination reuse the raw access across iterations.

2. **Wasm continuation stack memory**
   - `wasm/turboshaft-graph-interface.cc:3955-3970`
   - `CheckContAndGetStack` loads a `WasmStackObject`, decodes an external stack pointer with `LoadExternalPointerFromObject`, then reads raw stack metadata.
   - Need to verify whether stack checks / suspension paths can interleave with this raw pointer lifetime.

3. **Typed-array on-heap path remains a regression guard**
   - `typed-array-createtypedarray.tq:43-106`, `:120-153`
   - `machine-lowering-reducer-inl.h:2939-2951`, `:2975-2987`, `:4280-4293`
   - Current h6 does not reproduce stale writes, but keep it as an oracle if future source audit finds raw data pointer reuse rather than field-load reuse.

## Probe results in this slice

- **H7 stringref view access:** `REFUTED-SHAPE`. It reaches `WasmStackCheck(loop)` but lowers the character access through `WasmStringViewWtf16GetCodeUnit` stub calls, so it does not test inline raw pointer reuse.
- **H8 imported `js-string.codePointAt`:** `INCONCLUSIVE-NO-CRASH`. It reaches a better graph: `WasmStackCheck(loop)`, `LoadExternalPointer`, raw immutable character loads, fallback `WasmStringCodePointAt` calls, and `Retain(string)`. Current trace does not show `LoadExternalPointer` reused across the loop stack check.
- **H8b same-offset `js-string.codePointAt`:** `REFUTED-IMPACT`. It confirms a pre-loop `base`/`offset` tuple reused for post-stackcheck raw loads, but strings are immutable; sequential bases remain tagged and external resources are stable plus retained.
- **H10 cached Wasm `memory0_start`:** `REFUTED-TRIGGER`. It confirms cached raw Wasm memory base use across `WasmStackCheck(loop)`, but stackcheck-triggered GC does not move Wasm memory. `--stress-wasm-memory-moving` only forces movement on grow.
- **H10b `memory.grow` + stack switch:** `REFUTED-FIXED-PATH`. The current build reloads cached Wasm memory after `WasmFXSwitch`, so the direct stale-`mem_start_` regression path is covered.
- **H11 JS external-string `charCodeAt`:** `REFUTED-IMMUTABLE`. The JS external-string lowering lacks the explicit `Retain` seen in Wasm string lowering, but the observed value crossing `JSStackCheck(loop)` is an immutable character value, not a raw resource pointer.
- **H12 JS external-string dynamic-index `charCodeAt`:** `REFUTED-RELOAD`. The second dynamic character access reloads `ExternalStringResourceData` after the loop stack checks rather than reusing the earlier raw external pointer.
- **H13 `LoadStackArgument` CVE-2024-6773-style shape:** `REFUTED-FIXED-PATH`. Current `LoadStackArgumentOp` is tagged (`RegisterRepresentation::Tagged()` / `MemoryRepresentation::AnyTagged()`), so the public stale-raw-stack-argument primitive is fixed in this revision.
- **H14 WasmFX continuation stack pointer:** `REFUTED-ORDERING`. This hits a real external-pointer/raw-`StackMemory` path, but the loop `WasmStackCheck` occurs before `LoadExternalPointerFromObject(WasmStackObject::stack)`, including with `%ScheduleGCInStackCheck()` forcing the slow path.

## Next hypotheses

- **C4 pivot - same S2 reducer, store/memory-state sibling**
  C3 round should stop here unless a new source diff reveals a fresh raw-pointer producer. The direct C3 variants now close on immutable data, tagged recomputation, `Retain`, `NotLoadEliminable`, explicit Wasm memory reloads, fixed tagged stack-argument representation, or stackcheck-before-raw-pointer ordering.

- **If returning to WasmFX later**
  Treat it as a separate S4/S6-adjacent under-explored surface, not as this C3 stale-load slice. The interesting objects are continuation validity, raw `StackMemory` tagged fields, and suspend/resume handler reload rules.

## Infra note

`repro.sh` is safe for no extra flags, but passing extra d8 flags currently trips `asan-options.sh` because it is sourced while `$@` is non-empty. For extra flags, run `d8` directly with `ASAN_OPTIONS` and `ASAN_SYMBOLIZER_PATH`.
