# V8 C3 Slice - Late Load Elimination x GC Safepoints

**Date:** 2026-04-27
**Candidate:** `C3.S2`
**Surface:** Turboshaft late load elimination
**Violated contract:** Late load elimination must not reuse a previously loaded or derived memory value across an operation that can allocate / run GC unless that value remains valid and all dependent heap objects stay live.

## Working set

- `src/compiler/turboshaft/late-load-elimination-reducer.cc:222-295`
  `JSStackCheck` and `WasmStackCheck` are explicitly exempted from memory invalidation in this pass.
- `src/compiler/turboshaft/operations.h:3763-3785`
  `JSStackCheckOp::Kind::kLoop` has effects `CanDependOnChecks().CanDeopt().CanReadHeapMemory().CanAllocate()`.
- `src/runtime/runtime-test.cc:1248-1257`
  `%ScheduleGCInStackCheck()` requests a full GC on the next stack-check interrupt.
- `src/compiler/turboshaft/turbolev-graph-builder.cc:5559-5569`
  Maglev `HandleNoHeapWritesInterrupt` lowers to `JSLoopStackCheck` in Turbolev.
- `src/compiler/turboshaft/turbolev-graph-builder.cc:6385-6419`
  Typed-array accesses first load `external_pointer` and `base_pointer`, then call `LoadTypedElement` / `StoreTypedElement`.
- `src/compiler/turboshaft/machine-lowering-reducer-inl.h:4280-4293`
  `BuildTypedArrayDataPointer` turns `base_pointer + external_pointer` into a raw data pointer.
- `src/compiler/turboshaft/dataview-lowering-reducer.h:57-129`
  DataView accesses are explicitly hardened with `NotLoadEliminable()` plus `Retain(object)`.

## Why this slice

Recent in-tree regressions already document this bug family:

- `test/mjsunit/turbolev/dataview-load-not-stale-int32.js`
- `test/mjsunit/turbolev/dataview-load-not-stale-float64.js`
- `test/debugger/debug/compiler/regress-354005322.js`

The useful move now is not broad probing. It is **variant hunting around the fix boundary**:

1. `DataView` is clearly guarded.
2. `TypedArray` paths still materialize raw pointers in Turbolev before element access.
3. `JSStackCheck(kLoop)` can allocate / GC but is treated as non-interfering by late load elimination.

## Hypotheses

1. **H1 - typed-array external/base pointers are reused across `JSLoopStackCheck` GC**
   Repeated typed-array element accesses may CSE / GVN `external_pointer` or `base_pointer` loads across a loop stack-check safepoint, yielding a stale raw pointer on the second access.

2. **H2 - DataView direct access is fixed, but a nearby helper path still reuses stale raw state across `JSLoopStackCheck`**
   The explicit `Retain` + `NotLoadEliminable` hardening may not cover every DataView-adjacent path that produces a `WordPtr` from heap state.

3. **H3 - `%MajorGCForCompilerTesting()` is a clean reproducer for the same stale-load class**
   This compiler-testing op can allocate / trigger GC but is not treated like a memory-invalidating call in late load elimination, making it a strong oracle even if it is not itself a production trigger.

## Initial probes

- `h1-typedarray-stackcheck.js` - typed array repeated read separated by `%ScheduleGCInStackCheck()` and a loop.
- `h2-dataview-stackcheck.js` - DataView repeated read separated by `%ScheduleGCInStackCheck()` and a loop.
- `h3-typedarray-majorgc.js` - typed array repeated read separated by `%MajorGCForCompilerTesting()` as a control.
