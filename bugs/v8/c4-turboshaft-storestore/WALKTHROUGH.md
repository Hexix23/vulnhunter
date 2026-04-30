# C4 Walkthrough - Turboshaft Store-Store Elimination

## Scope

Target reducer: `src/compiler/turboshaft/store-store-elimination-reducer-inl.h`.

Contract tested: a store can be removed only when no later load, alias, deopt, GC, or map/property transition can observe either the value or the initialization side effect.

## What Was Probed

- GC-observable initialization stores around allocation and stack checks.
- The 32-bit adjacent-store merge into a raw `Uint64`.
- Non-read-only heap constants and write-barrier/relocation safety.
- Mixed-size property transitions.
- Same-offset aliasing through `Phi`-selected object bases.
- `PropertyArray` partial overlap: merged wide initialization followed by smaller overwrite.

## Result

No VRP-grade bug confirmed in C4.

The most useful evidence is not H4/H5; it is H7. H7 reaches the concrete lower-level shape that H5 was trying to express:

- adjacent `PropertyArray` initialization stores at offsets `+8` and `+12`
- reducer emits a raw `Uint64` merged store
- later `TaggedSigned` store overwrites only offset `+8`

That passes ASan + `--verify-heap` and release differential. The protective source path is the size guard in `MarkStoreAsUnobservable`: a smaller store does not fully shadow a wider key.

## Why H4/H5 Did Not Land

- H4 is blocked by the non-read-only constant guard in `TryGetRawUint32Constant`; object constants that need relocation/barrier are not merged.
- H5 initially missed the exact partial-overlap shape because property representation transitions normalize or deopt before exposing an unsafe same-base+offset mismatch.
- H7 then reached the partial-overlap shape through `PropertyArray` allocation and still passed.

## Next Step

Do not keep spending generic JS probes on C4. If C4 stays active, the only reasonable next move is a source-level reducer unittest or patch-diff of recent store-store changes. For bug hunting momentum, pivot to another P1 surface with recent CVE lineage: S6 GC x marker race, S4 Wasm canonical types, S7 Temporal deeper spec/integration, or S8 RegExp `/v`.
