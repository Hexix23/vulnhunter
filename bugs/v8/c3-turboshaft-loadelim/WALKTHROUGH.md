# C3.S2 Walkthrough

## Scope

This round targeted the `C3` variant suggested by the source-level mismatch between:

- `src/compiler/turboshaft/late-load-elimination-reducer.cc:260-275`, where `JSStackCheck` is exempted from memory invalidation
- `src/compiler/turboshaft/operations.h:3763-3785`, where `JSStackCheckOp::Kind::kLoop` can allocate and therefore run GC-sensitive work
- `src/compiler/turboshaft/turbolev-graph-builder.cc:6385-6419`, where typed-array accesses first materialize `external_pointer` and `base_pointer`
- `src/compiler/turboshaft/dataview-lowering-reducer.h:57-129`, where DataView already carries an explicit stale-load fix boundary

The concrete question was whether late load elimination could reuse heap-derived pointer state across `JSLoopStackCheck` and turn that into a stale raw pointer after GC.

## What was probed

1. `poc/h1-typedarray-stackcheck.js`
   Read from an `Int32Array`, schedule GC, spin a loop to force `JSStackCheck(loop)`, then read again.

2. `poc/h2-dataview-stackcheck.js`
   Same shape for `DataView` to check whether the in-tree fix boundary still held.

3. `poc/h3-typedarray-majorgc.js`
   Control probe using `%MajorGCForCompilerTesting()` between two typed-array reads.

4. `poc/h4-typedarray-prescheduled-stackcheck.js`
   Refined typed-array probe. GC is scheduled before the first read so that the only intended safepoint between the two reads is the loop stack check.

5. `poc/h5-dataview-prescheduled-stackcheck.js`
   Refined DataView version of `h4`.

## Result

All five probes were refuted for this slice.

- `h1` through `h5` returned `OK` in both ASan and Release.
- No crash, sanitizer finding, DCHECK, or output divergence appeared in `evidence/h1-asan.txt` through `evidence/h5-release.txt`.
- The `h4` reduction trace confirmed the optimizer behavior that motivated the slice: after the pre-scheduled GC read, the exit-block loads are rewritten to earlier values across the loop path.

## Important trace finding

The first typed-array shape (`h1`) was too weak because `%ScheduleGCInStackCheck()` itself is a call. The earlier trace showed `ProcessCall(...)` invalidating maybe-aliasing memory before the loop, so that shape could not demonstrate reuse across the loop safepoint alone.

`h4` fixed that by scheduling the GC before the first post-call read. The saved trace in `evidence/h4-loadelim-trace.txt` shows:

- `:573-599` the post-call typed-array field loads feeding the first read
- `:597-687` loop `JSStackCheck` nodes remaining in the graph
- `:808-826` the exit-block field loads `o165` and `o166` being replaced with the earlier values `#n74` and `#n75`

So the optimization hypothesis was real: field-load reuse across `JSStackCheck(loop)` is happening.

## Why the probes failed

The source audit explains why the visible reuse did not become a security bug in this particular shape:

- Normal JS-created typed arrays are initialized via `Factory::NewJSTypedArray(...)`, which immediately calls `SetOffHeapDataPtr(...)`.
- `SetOffHeapDataPtr(...)` writes `base_pointer = Smi::zero()`, making ordinary JS-created typed arrays off-heap in this representation.
- The reused state in `h4` is therefore the stable off-heap backing-store pointer plus zero base, not a pointer into movable heap memory.
- DataView already carries the explicit stale-load hardening (`NotLoadEliminable()` plus `Retain(object)`), which is why `h2` and `h5` stayed quiet.
- `%MajorGCForCompilerTesting()` goes through the normal call invalidation path, so it is not a second production-shaped bypass of the same kind.

## Next follow-up

If `C3` stays open, the next worthwhile move is not more ordinary typed-array/DataView probing. Better follow-ups are:

1. look for a JS-reachable path that produces a heap-derived `WordPtr` or tagged-base-plus-offset address across `JSStackCheck(loop)` without the DataView hardening and without the typed-array off-heap safety property
2. inspect other Turbolev lowering helpers that materialize raw addresses from heap fields, especially where the backing object can move or where `Retain(...)` is absent
3. if no such path exists in user-reachable JS, park this `C3` sub-slice as refuted and pivot to another P1 candidate to preserve hunt diversity
