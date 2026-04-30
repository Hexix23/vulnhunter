# C3.S2 Verdict

## H1 - typed-array pointer field loads are reused across `JSStackCheck(loop)` and become stale after GC

Verdict: `REFUTED`

Evidence:
- `evidence/h1-asan.txt`
- `evidence/h1-release.txt`
- `evidence/h4-asan.txt`
- `evidence/h4-release.txt`
- `evidence/h4-loadelim-trace.txt`

Observed behavior:
- `h1` and `h4` both returned `OK` in ASan and Release.
- The optimized `h4` trace does show late load elimination reusing the typed-array field loads across the loop path: `evidence/h4-loadelim-trace.txt:573-599` materializes the post-`ScheduleGCInStackCheck` loads, and `:808-826` rewrites the exit-block loads `o165` and `o166` to the earlier values `#n74` and `#n75`.
- That reuse did not become a stale movable-heap pointer in this JS-reachable shape.

Updated interpretation:
- `src/compiler/turboshaft/late-load-elimination-reducer.cc:260-275` explicitly treats `JSStackCheck` as non-interfering for this pass, which explains why the reuse is visible in the trace.
- The original "ordinary JS-created typed arrays are off-heap" explanation was too broad. This build has `V8_TYPED_ARRAY_MAX_SIZE_IN_HEAP=64`, and H6 confirms small typed arrays start on-heap.
- The refuted shape is narrower: the reused values are typed-array fields, not a raw data pointer that survives across the stack-check GC. The actual data pointer is rebuilt from tagged state later.

## H2 - DataView-adjacent loads still reuse stale raw state across `JSStackCheck(loop)` despite the fix

Verdict: `REFUTED`

Evidence:
- `evidence/h2-asan.txt`
- `evidence/h2-release.txt`
- `evidence/h5-asan.txt`
- `evidence/h5-release.txt`

Observed behavior:
- `h2` and `h5` both returned `OK` in ASan and Release.
- No crash, DCHECK, or visible divergence was observed when repeating DataView reads across a scheduled stack-check GC.

Protective path:
- `src/compiler/turboshaft/dataview-lowering-reducer.h:66-90` lowers DataView loads with `Load(...NotLoadEliminable())` and then `Retain(object)` to keep the relevant object alive across GC-sensitive work.
- `src/compiler/turboshaft/dataview-lowering-reducer.h:118-128` applies the same hardening on stores.

## H3 - `%MajorGCForCompilerTesting()` is a clean reproducer for the same stale-load class

Verdict: `REFUTED`

Evidence:
- `evidence/h3-asan.txt`
- `evidence/h3-release.txt`

Observed behavior:
- `h3` returned `OK` in ASan and Release.
- No ASan-only failure or optimized/interpreter divergence surfaced.

Protective path:
- `src/compiler/turboshaft/late-load-elimination-reducer.cc:509-537` makes generic memory-writing calls invalidate maybe-aliasing memory through `ProcessCall(...)` and `memory_.InvalidateMaybeAliasing()`.
- This means `%MajorGCForCompilerTesting()` is not analogous to the `JSStackCheck` exemption for this pass; it goes through the normal call invalidation path.

## H6 - on-heap typed-array store after `JSStackCheck(loop)`

Verdict: `REFUTED-SHAPE`

Evidence:
- `evidence/h6-asan-compact.txt`
- `evidence/h6-release-compact.txt`
- `evidence/h6-loadelim-trace.txt`

Observed behavior:
- `new Int32Array(2)` is an on-heap typed array in this build (`V8_TYPED_ARRAY_MAX_SIZE_IN_HEAP=64`), so the earlier broad "ordinary JS-created typed arrays are off-heap" explanation was incomplete.
- The improved oracle writes after the stack-check GC and reads back through a cold helper. ASan and Release both returned `OK`, including `--compact-on-every-full-gc`.
- The trace still shows `JSTypedArrayBasePointer` / `JSTypedArrayExternalPointer` field loads reused across `JSStackCheck(loop)`, but no stale store was observed.

Updated interpretation:
- This typed-array shape appears protected because the reused base is a tagged value that remains visible to the safepoint and can be updated by GC. The raw data pointer is rebuilt from tagged base plus external offset rather than reused as a raw pointer across the stack-check GC.

## H7 - Wasm stringref view access across `WasmStackCheck(loop)`

Verdict: `REFUTED-SHAPE`

Evidence:
- `poc/h7-wasm-stringref-stackcheck.js`
- `evidence/h7-asan-compact.txt`
- `evidence/h7-release-compact.txt`
- `evidence/h7-loadelim-trace.txt`

Observed behavior:
- ASan and Release both returned `OK`.
- The harness successfully forced `WasmStackCheck(loop)` and scheduled compacting GC, but the interesting string character operation lowered to `WasmStringViewWtf16GetCodeUnit` stub calls rather than the inline raw-pointer path.

Reason this does not close C3:
- This probe validates the stringref harness but mostly hits a call boundary, so normal call effects and `Retain` placement dominate. It does not prove the inline Turboshaft string lowering is safe.

## H8 - Wasm imported `js-string.codePointAt` external-string path across `WasmStackCheck(loop)`

Verdict: `INCONCLUSIVE-NO-CRASH`

Evidence:
- `poc/h8-wasm-imported-string-codepoint-stackcheck.js`
- `evidence/h8-asan-compact.txt`
- `evidence/h8-release-compact.txt`
- `evidence/h8-loadelim-trace.txt`

Observed behavior:
- ASan and Release both returned `OK`.
- The trace confirms all target ingredients exist in one optimized graph: `WasmStackCheck(loop)`, `WasmStringCodePointAt` fallback calls, `LoadExternalPointer(...)`, raw immutable character loads, and `Retain(string)`.
- The visible `LoadExternalPointer` lowering is local to the string-access block (`evidence/h8-loadelim-trace.txt:1864`, `:2723`) and is not currently shown as reused across the loop `WasmStackCheck` (`:2114-2115`, `:3001-3002`).

Current interpretation:
- H8 is the closest C3b probe so far, but it has not demonstrated stale raw-pointer reuse or output divergence. Treat it as a trace-guided harness for the next iteration, not as a refutation of the reducer-level candidate.

## H8b - Wasm imported `js-string.codePointAt`, same offset before/after `WasmStackCheck(loop)`

Verdict: `REFUTED-IMPACT`

Evidence:
- `poc/h8b-wasm-codepoint-same-offset-stackcheck.js`
- `evidence/h8b-asan-compact.txt`
- `evidence/h8b-release-compact.txt`
- `evidence/h8b-loadelim-trace.txt`

Observed behavior:
- ASan and Release both returned `OK`.
- The trace confirms the intended shape: a `base` tagged value plus `Word64` offset tuple is computed before the loop and reused after `WasmStackCheck(loop)`. See `h8b-loadelim-trace.txt:3663-3667` for the tuple and `:3895-3961` for the post-stackcheck raw load using the same values.

Impact analysis:
- Sequential-string cases keep the base as a tagged value; the raw address is rebuilt after the stackcheck, so GC can update the tagged root.
- External-string cases can carry a raw resource pointer in the offset, but that resource is not moved by GC and `Retain(string)` keeps the external resource alive.
- This confirms the C3b structural pattern but does not produce a reportable primitive in the string path.

## H10 - Wasm cached `memory0_start` across stack-check GC

Verdict: `REFUTED-TRIGGER`

Evidence:
- `poc/h10-wasm-memstart-stackcheck-gc.js`
- `evidence/h10-asan-memory-moving.txt`
- `evidence/h10-release-memory-moving.txt`
- `evidence/h10-loadelim-trace.txt`

Observed behavior:
- ASan and Release both returned `OK` under `--no-wasm-trap-handler --stress-wasm-memory-moving --compact-on-every-full-gc`.
- The trace shows `memory0_start` loaded after the import call and reused as the raw memory base for loads after `WasmStackCheck(loop)`: `h10-loadelim-trace.txt:676-688`, `:758-790`.
- A full GC did run from the stackcheck (`h10-loadelim-trace.txt:806`) but did not invalidate the Wasm memory backing store.

Protective/limiting path:
- `src/flags/flag-definitions.h:2196-2197` defines `--stress-wasm-memory-moving` as moving non-shared bounds-checked Wasm memory on grow, not on GC.
- `src/wasm/wasm-objects.cc:1110-1115` gates moving behavior through grow logic.
- So this PoC proves the cache shape but does not trigger a stale backing-store read. The next memory variant needs `memory.grow` or stack switching, not just stackcheck-GC.

## H10b - Wasm `memory.grow` + stack switching stale `mem_start_` regression reduction

Verdict: `REFUTED-FIXED-PATH`

Evidence:
- `poc/h10b-wasm-grow-switch-stale-memstart.js`
- `evidence/h10b-asan.txt`
- `evidence/h10b-release.txt`
- `evidence/h10b-loadelim-trace.txt`
- `evidence/regress-497667917-asan.txt`

Observed behavior:
- The upstream regression `test/mjsunit/wasm/regress-497667917.js` passes in this build.
- The reduced local probe also returns `OK` in ASan and Release with `--experimental-wasm-wasmfx --stress-wasm-memory-moving --no-wasm-trap-handler`.
- The trace shows the protective pattern: after `WasmFXSwitch`, the code reloads `memory0_start` from the trusted instance before the raw memory load. See `h10b-loadelim-trace.txt:1185-1206` and `:1976-1990`.

Protective path:
- `src/wasm/turboshaft-graph-interface.cc:4202` calls `instance_cache_.ReloadCachedMemory()` after `WasmFXSwitch`.
- `src/wasm/turboshaft-graph-interface.cc:4091`, `:4214`, `:4284`, `:8546`, `:8712`, and `:9480` cover related continuation/call paths.
- This closes the direct stale-`mem_start_` stack-switch/grow variant for current `14.8.178.9`, but it remains a strong pattern for future patch-diff variants.

## H11 - JS external-string `charCodeAt` across `JSStackCheck(loop)`

Verdict: `REFUTED-IMMUTABLE`

Evidence:
- `poc/h11-js-external-string-charcode-stackcheck.js`
- `evidence/h11-asan.txt`
- `evidence/h11-release.txt`
- `evidence/h11-loadelim-trace.txt`

Observed behavior:
- ASan and Release both returned `OK`.
- Source audit found that `StringAt` external-string lowering loads `ExternalStringResourceData` and performs raw character loads without an explicit `Retain(receiver)` in `machine-lowering-reducer-inl.h:2540-2625`.
- The trace confirms `LoadExternalPointer` and raw external-string loads (`h11-loadelim-trace.txt:586-613`, `:2734-2780`), but the optimized result is a string character value, not a raw resource pointer carried live across `JSStackCheck(loop)`.
- The loop stack checks are present (`h11-loadelim-trace.txt:4112-4242`), but the value crossing the loop is the immutable character result.

Impact analysis:
- This is not a C3 primitive as-is because string contents are immutable and the external resource pointer is not used after the stackcheck in this shape.
- The missing explicit `Retain` in this JS string path is worth tracking separately, but the current probe does not show lifetime breakage or divergence.

## H12 - JS external-string dynamic-index `charCodeAt` across `JSStackCheck(loop)`

Verdict: `REFUTED-RELOAD`

Evidence:
- `poc/h12-js-external-string-dynamic-index-stackcheck.js`
- `evidence/h12-asan.txt`
- `evidence/h12-release.txt`
- `evidence/h12-loadelim-trace.txt`

Observed behavior:
- ASan and Release both returned `OK`.
- The probe forces a first external-string `charCodeAt(1)` before the loop and a second `charCodeAt(j)` after the loop, where `j` depends on loop state so the second access cannot collapse to the same constant access as H11.
- The trace shows the first `StringAt` external path loading `ExternalStringResourceData` before the loop, then the second dynamic-index `StringAt` reloads the external pointer after the loop stack checks instead of reusing the first raw pointer. See `h12-loadelim-trace.txt:1165-1235` and the lowered raw external-string loads around `:4285-4365`.
- No stale raw pointer crosses the `JSStackCheck(loop)` in this shape.

Impact analysis:
- This closes the most direct JS external-string C3b shape for current `14.8.178.9`.
- The source asymmetry remains useful for audit (`StringAt` JS lowering has no explicit `Retain(receiver)`, while Wasm string lowering does), but H12 shows the dynamic second access recomputes the external pointer at the use site.

## H13 - `LoadStackArgument` CVE-2024-6773-style shape

Verdict: `REFUTED-FIXED-PATH`

Evidence:
- `poc/h13-loadstackargument-cve6773-shape.js`
- `evidence/h13-asan.txt`
- `evidence/h13-release.txt`
- `evidence/h13-loadelim-trace.txt`

Observed behavior:
- ASan and Release both returned `OK`.
- This is a trace oracle for the public CVE-2024-6773 class: stale stack-argument load state reused across allocation/GC.
- Current source lowers `LoadStackArgumentOp` as tagged data, not as a reusable raw pointer. `src/compiler/turboshaft/operations.h:6403-6422` declares the result as `RegisterRepresentation::Tagged()`, and `src/compiler/turboshaft/machine-lowering-reducer-inl.h:2954-2970` loads it with `MemoryRepresentation::AnyTagged()`.
- The trace matches the source fix: `LoadStackArgument` appears with `AnyTagged` / `Tagged` representation in `h13-loadelim-trace.txt`.

Impact analysis:
- The direct CVE-2024-6773 variant is fixed in this V8 revision.
- Future C3 work should not keep probing `LoadStackArgument` itself unless a different lowering path produces a `WordPtr` from the argument before a non-invalidating stackcheck.

## H14 - WasmFX continuation stack external pointer across `WasmStackCheck(loop)`

Verdict: `REFUTED-ORDERING`

Evidence:
- `poc/h14-wasmfx-stack-pointer-loop-stackcheck.js`
- `evidence/h14-asan.txt`
- `evidence/h14-release.txt`
- `evidence/h14-loadelim-trace.txt`

Observed behavior:
- ASan and Release both returned `OK`.
- The PoC uses a coroutine loop with `switch`, enables WasmFX, and calls `%ScheduleGCInStackCheck()` before entering the Wasm loop to force the stack-check slow path.
- Source audit: `src/wasm/turboshaft-graph-interface.cc:3955-3975` decodes `WasmStackObject::stack` with `LoadExternalPointerFromObject(...)` and then reads raw `StackMemory::current_continuation_offset()`. `Switch(...)` then reads `StackMemory::arg_buffer_offset()` at `:4152-4162`.
- The trace shows `WasmStackCheck(loop)` before the continuation stack decode, not after it. The lowered slow path includes `WasmStackGuardLoop` (`h14-loadelim-trace.txt:1880-1887`), followed later by the external-pointer decode and raw `StackMemory` reads (`:2033`, `:2149`).
- Earlier reducer stages show the same ordering: loop stackcheck at `h14-loadelim-trace.txt:1303-1304`, then `LoadExternalPointer` at `:1379-1380`, then raw `StackMemory` loads at `:1391-1425`.

Impact analysis:
- This is the right raw-pointer class, but this shape does not let the decoded `StackMemory*` cross a loop stackcheck. The pointer is derived after the safepoint in the loop body.
- Keep WasmFX stack switching in the broader matrix because it is under-explored and security-sensitive, but not as a C3 late-load-elimination stale pointer repro.

## Overall

Verdict: `C3-ROUND-CLOSED-NO-CONFIRMED-BUG`

The specific typed-array, DataView, Wasm string, stackcheck-GC memory, JS external-string, direct `LoadStackArgument`, and WasmFX continuation-stack shapes are refuted or inconclusive. The reducer-level modeling concern remains real in source: `LateLoadElimination` treats `JSStackCheck(loop)` / `WasmStackCheck(loop)` as non-interfering even though stack checks can allocate and run GC. However, the audited C3 shapes in this round all close on one of these defenses: tagged recomputation, `Retain`, `NotLoadEliminable`, immutable data, explicit Wasm memory reload, fixed tagged stack-argument representation, or stackcheck-before-raw-pointer ordering.

Do not keep re-testing C3 with the same ingredient set. Next action for S2 should be sibling `C4`, focusing on store/memory-state replacement rather than raw-pointer lifetime.
