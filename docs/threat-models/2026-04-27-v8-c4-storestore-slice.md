# V8 C4 Slice - Turboshaft Store-Store Elimination

**Date:** 2026-04-27
**Candidate:** `C4.S2`
**Surface:** `src/compiler/turboshaft/store-store-elimination-reducer-inl.h`
**Violated contract:** A store may be removed only if no later observer, GC, load, alias, deopt, or control transfer can observe the overwritten value or the fact that the field was initialized.

## Why pivot from C3

C3 raw-pointer lifetime variants were probed through typed arrays, DataView, Wasm strings, JS external strings, `LoadStackArgument`, and WasmFX continuation stacks. The direct shapes closed on tagged recomputation, `Retain`, `NotLoadEliminable`, immutable data, fixed tagged representation, or stackcheck-before-raw-pointer ordering.

Chrome Releases 2026 still shows active V8 bug classes relevant to this surface: out-of-bounds read/write, type confusion, object corruption, race, use-after-free, integer overflow, and inappropriate implementation. That supports continuing on S2, but with C4's store/memory-state angle rather than repeating C3.

## Source contracts

- `MaybeRedundantStoresTable` tracks stores by `base + offset + size` semantics, but the key map is indexed by `base + offset`.
- Backward analysis marks stores `Unobservable`, `GCObservable`, or `Observable`.
- `MarkAllStoresAsGCObservable()` is the critical defense for allocations / consistent-heap operations.
- `ProcessBlock()` treats `effects.can_read_mutable_memory()` as fully observable, and `effects.requires_consistent_heap()` as GC-observable.
- `StoreOp::Effects()` sets `CanDoRawHeapAccess()` for initializing/transitioning stores.
- `JSStackCheck(loop)` and `WasmStackCheck(loop)` can allocate, so they should become GC-observable barriers in this analysis.

## Initial hypotheses

- **H1 - allocation-pressure regression guard:** array hole initialization must not be removed before later overwrite if allocations can trigger GC.
- **H2 - stackcheck-GC variant:** `JSStackCheck(loop)` between allocation and overwrite must mark initial stores `GCObservable`.
- **H3 - size/partial-overlap variant:** same `base + offset` with different store sizes must not let a smaller/larger store hide a partially observable previous store.
- **H4 - merge-pair variant:** consecutive 32-bit initializing stores must only merge into `Uint64` when both values are read-only/non-movable and no write barrier/relocation is needed.
- **H6 - alias/map-transition variant:** same-offset stores through `Phi`-selected bases and property transitions must remain observable if the bases can alias at runtime.
- **H7 - partial-overlap variant:** a wide merged initialization store must not be treated as fully shadowed by a later smaller store to the same base+offset.

## Probe results

- **H1 array hole initialization across allocation pressure:** `REFUTED-REGRESSION-GUARD`. ASan + `--verify-heap` and release both return `OK`.
- **H2 array hole initialization across `JSStackCheck(loop)` GC:** `REFUTED-GCOBSERVABLE-BARRIER`. The no-escape trace keeps initialization stores visible, shows `JSStackCheck(loop)`, and keeps the later overwrite. Source explanation: `JSStackCheck(loop)` can allocate, so it requires a consistent heap and marks active stores `GCObservable`.
- **H3 object initialization merge-pair oracle:** `REFUTED-MERGE-SAFE`. The trace confirms two adjacent initializing stores can merge into a raw `Uint64` store, but the observed merge is limited to read-only/no-write-barrier constants and outputs match with/without store elimination.
- **H4 non-read-only heap object constants:** `REFUTED-WRITE-BARRIER-GUARD`. Marker object stores do not merge into raw `Uint64`; they remain pointer stores with barrier semantics before lowering and skipped-barrier semantics only after allocation analysis.
- **H5 mixed-size property transition:** `REFUTED-SHAPE`. The probe generates `Float64` stores, but property representation is protected by deopt/map normalization before creating a same-`base + offset` mixed-size store-store ambiguity.
- **H6 alias/map-transition ambiguity:** `REFUTED-ALIAS-OBSERVED`. Optimized aliasing selectors, same-map object bases, and property-transition stores return correct values with and without store-store elimination. The trace shows the relevant fixed-offset stores and final loads are retained (`h6-trace.txt:2291-2317`, `:5700-6123`, `:6640-6790`).
- **H7 PropertyArray partial-overlap:** `REFUTED-PARTIAL-OVERLAP-GUARD`. This reaches the lower-level shape H5 was aiming for: adjacent `PropertyArray` initialization stores at `+8/+12` merge to raw `Uint64`, then a later `TaggedSigned` store overwrites only `+8` (`h7-trace.txt:2709-2722`). ASan + heap verification and release differential both return `OK`. Source guard: `MarkStoreAsUnobservable` does not let a smaller store fully shadow a wider key.

## Next hypotheses

No further generic JS C4 probe is justified from the current evidence. If C4 remains in scope, the next step should be a source-level reducer unittest or patch-diff against recent store-store changes, not another high-level object-property variant.
