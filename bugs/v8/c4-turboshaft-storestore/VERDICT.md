# C4.S2 Verdict

## Source Audit

Target: `src/compiler/turboshaft/store-store-elimination-reducer-inl.h`

Key contracts:
- The reducer runs backwards and tracks fixed-offset, on-heap stores by `base + offset`.
- Loads mark potentially aliasing stores at the same offset observable.
- Allocations or operations requiring a consistent heap mark currently unobservable stores as `GCObservable`.
- A `GCObservable` initializing store must be kept; non-initializing stores may still be removed.
- The same reducer can merge two consecutive 32-bit initializing tagged stores into one 64-bit raw store if both constants are non-movable/read-only.

## H1 - array hole initialization across allocation pressure

Verdict: `REFUTED-REGRESSION-GUARD`

Evidence:
- `poc/h1-array-hole-init-gcobservable.js`
- `evidence/h1-asan.txt`
- `evidence/h1-release.txt`

Observed behavior:
- ASan + `--verify-heap` returned `OK`.
- Release returned `OK`.
- This closes the direct regression shape from `test/mjsunit/compiler/regress-crbug-1464516.js`: array hole initialization is not incorrectly removed before allocation pressure that can trigger GC.

## H2 - array hole initialization across `JSStackCheck(loop)` GC

Verdict: `REFUTED-GCOBSERVABLE-BARRIER`

Evidence:
- `poc/h2-array-hole-init-stackcheck-gc.js`
- `evidence/h2-asan.txt`
- `evidence/h2-release.txt`
- `evidence/h2-trace.txt`
- `evidence/h2-noescape-trace.txt`

Observed behavior:
- ASan + `--verify-heap` + `--compact-on-every-full-gc` returned `OK`.
- Release returned `OK`.
- With `--no-turbo-escape --no-turbo-allocation-folding`, the trace keeps the interesting object/FixedArray initialization stores in graph form. It shows FixedArray hole initialization stores before the loop (`h2-noescape-trace.txt:49-74`, `:299-324`, `:1489-1525`) and `JSStackCheck(loop)` after the allocation (`:399-400`, `:1115-1116`, `:1270-1271`, `:1670-1671`).
- The final overwrite of `arr[3]` remains after the stackcheck (`h2-noescape-trace.txt:526-527`, `:1339-1340`, `:1919-1921`).

Interpretation:
- This was the highest-signal C4 analogue of the C3 stackcheck concern. It did not reproduce a missing GC-observable barrier.
- Source explanation: `JSStackCheck(loop)` has `CanAllocate()`, and `CanAllocate()` implies `AssumesConsistentHeap()`. In the store-store analysis default path, `effects.requires_consistent_heap()` marks active stores `GCObservable`, so initializing stores are retained.

## H3 - object initialization merge-pair oracle

Verdict: `REFUTED-MERGE-SAFE`

Evidence:
- `poc/h3-object-init-merge-pair.js`
- `evidence/h3-asan.txt`
- `evidence/h3-release.txt`
- `evidence/h3-release-no-storeelim.txt`
- `evidence/h3-trace.txt`

Observed behavior:
- ASan + `--verify-heap` returned `OK`.
- Release returned `OK` both with and without `--turbo-store-elimination`.
- The trace confirms the merge-pair mechanism is active: two adjacent initializing stores are lowered into a raw `Uint64` store in the optimized graph (`h3-trace.txt:449-453`).
- The merged pair uses read-only constants / no-write-barrier conditions. Later observable dynamic fields are not merged into the pair (`h3-trace.txt:469-488`).

Interpretation:
- This confirms C4's merge side is reachable from JS and should stay in the hunt matrix.
- The tested safe read-only-root pair does not show a relocation/write-barrier bug.

## H4 - non-read-only heap object constants must not merge

Verdict: `REFUTED-WRITE-BARRIER-GUARD`

Evidence:
- `poc/h4-object-init-nonreadonly-merge-guard.js`
- `evidence/h4-asan.txt`
- `evidence/h4-release.txt`
- `evidence/h4-release-no-storeelim.txt`
- `evidence/h4-trace.txt`

Observed behavior:
- ASan + `--verify-heap` + compacting GC returned `OK`.
- Release returned `OK` both with and without `--turbo-store-elimination`.
- The trace shows the marker object constants are non-read-only heap objects (`h4-trace.txt:37-38`, `:61-62`) and their stores carry pointer-barrier semantics before lowering (`:64-68`).
- In the optimized graph these stores lower with `SkippedWriteBarrier` after allocation analysis, but they remain separate tagged/raw pointer stores and do not become a single merged raw `Uint64` store (`h4-trace.txt:475-483`).

Interpretation:
- This validates the intended guard in `TryGetRawUint32Constant`: non-read-only heap object constants are not eligible for the merge pair.
- The merge remains reachable for read-only roots, but H4 did not produce a relocation/write-barrier loss.

## H5 - mixed-size property transition store

Verdict: `REFUTED-SHAPE`

Evidence:
- `poc/h5-overlap-size-transition-store.js`
- `evidence/h5-asan.txt`
- `evidence/h5-release.txt`
- `evidence/h5-release-no-storeelim.txt`
- `evidence/h5-trace.txt`

Observed behavior:
- ASan + `--verify-heap` returned `OK`.
- Release returned `OK` both with and without `--turbo-store-elimination`.
- The trace confirms `Float64` stores are generated for the optimized double-property path (`h5-trace.txt:141-142`, `:618-622`, `:1075-1079`, `:1658-1666`).
- The Smi-only path is protected by `DeoptimizeIf(NotASmi)` checks before the double path (`h5-trace.txt:167-168`, `:645-646`, `:1517-1518`).
- This does not create the desired same-`base + offset` mixed-size overlap inside store-store elimination; the map/property representation transition is normalized before the reducer sees a dangerous partial-overlap replacement.

Interpretation:
- H5 did not hit the table-size ambiguity directly.
- The next partial-overlap attempt should use a lower-level object shape that naturally emits adjacent `TaggedPointer` / `AnyTagged` / `TaggedSigned` stores at fixed offsets without property-transition deopt, or switch to a source-level unittest-style reproducer if JS cannot express it.

## H6 - alias/map-transition ambiguity

Verdict: `REFUTED-ALIAS-OBSERVED`

Evidence:
- `poc/h6-alias-map-transition.js`
- `evidence/h6-asan.txt`
- `evidence/h6-release.txt`
- `evidence/h6-release-no-storeelim.txt`
- `evidence/h6-trace.txt`

Observed behavior:
- ASan + `--verify-heap` + compacting GC returned `OK`.
- Release returned `OK` both with and without `--turbo-store-elimination`.
- The trace confirms the probe reached optimized fixed-offset stores on potentially aliasing bases. In `alias_existing`, the reducer keeps both stores to offset `12` and the later load from the selected alias base (`h6-trace.txt:2291-2317`).
- The property-transition variant keeps the descriptor/property-array transition stores and returns through the final load of the transitioned field (`h6-trace.txt:5700-6123`).
- The two-selector alias variant keeps the first store, second store, and final load at the same offset across `Phi`-selected bases (`h6-trace.txt:6640-6790`).

Interpretation:
- This directly probed the table contract where loads mark all active stores at the same offset observable while stores are eliminated only by exact `base + offset`.
- The JS shapes do not expose a wrong assumption that two same-map object bases are disjoint. Map checks and same-offset loads keep the stores observable before the value is read.
- H6 closes the high-level alias/map-transition C4 shape. It does not close the lower-level mixed-size overlap issue from H5.

## H7 - PropertyArray partial-overlap after merged initialization

Verdict: `REFUTED-PARTIAL-OVERLAP-GUARD`

Evidence:
- `poc/h7-property-array-partial-overlap.js`
- `evidence/h7-asan.txt`
- `evidence/h7-release.txt`
- `evidence/h7-release-no-storeelim.txt`
- `evidence/h7-trace.txt`

Observed behavior:
- ASan + `--verify-heap` + compacting GC returned `OK`.
- Release returned `OK` both with and without `--turbo-store-elimination`.
- The isolated trace reaches the desired lower-level shape. A property transition initializes adjacent `PropertyArray` slots at offsets `+8` and `+12`, and the reducer emits the merged raw `Uint64` store (`h7-trace.txt:2709-2715`).
- A later smaller store overwrites only offset `+8` (`h7-trace.txt:2719-2722`), and the object/map stores are retained after the transition (`h7-trace.txt:2727-2733`).

Interpretation:
- This is the concrete partial-overlap C4 shape that H5 failed to express cleanly.
- It does not crash or diverge because the reducer's size guard prevents a smaller later store from making a wider earlier store fully unobservable: `MarkStoreAsUnobservable` returns when `size < key.data().size`.
- H7 closes the JS-expressible partial-overlap variant for property-array initialization. A pure reducer unittest could still be useful as upstream test coverage, but it is not a VRP-grade bug by itself.

## Overall

Verdict: `OPEN`

This C4 round starts from the GC-observable initialization rule rather than the C3 raw-pointer lifetime rule. H1-H7 did not find a bug, but H3 proves the merge-pair transformation is reachable from JS. H4 validates that non-read-only heap constants are not merged. H6 did not expose a high-level alias/map-transition failure, and H7 reaches then refutes the JS-expressible partial-overlap shape. At this point C4 has no confirmed bug. Continuing C4 would require source-level reducer tests or patch-diffing recent store-store changes, not more generic JS probes.
