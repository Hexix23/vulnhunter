# C21 Chain Expansion Plan

Concern: H1-H4 proved a release sink/crash, but stopping there is too shallow.
This file defines the required expansion ladder before calling C21 exhausted.

## Ladder

1. **Direct forge-ref**
   - Put controlled tagged pointer bytes into numeric `i64` global storage.
   - Flip `raw_type` to `externref`.
   - Read `global.value`.
   - Goal: prove getter can manufacture a JS reference from numeric bytes.

2. **Hidden-root / stale-root**
   - Store object pointer through forged or setter path.
   - Drop normal JS references.
   - Exercise minor GC, major GC, compaction, incremental marking.
   - Goal: decide whether the hidden pointer is traced, stale, or crash-only.

3. **Reuse shaping**
   - Spray same-size/same-map objects, arrays, strings, typed arrays, and Wasm
     refs after freeing original object.
   - Goal: turn stale pointer into controlled object reuse or type confusion.

4. **Object-kind matrix**
   - Repeat H2/H3 with JSObject, Array, String, ArrayBuffer, TypedArray,
     WasmFuncRef, WasmArray/WasmStruct when available.
   - Goal: find a kind whose stale pointer path becomes useful, not just crash.
   - H7: live forged-reference matrix.
   - H8: stale forged-reference one-kind process matrix.

5. **GC-mode matrix**
   - `gc()`, repeated allocation, `--stress-compaction`,
     `--stress-incremental-marking`, `--stress-marking`, young-generation churn.
   - Goal: map exact collector/visitor that mishandles hidden slot.

6. **Sink siblings**
   - Move same method to `WasmTableObject.raw_type`,
     `WasmFuncRef.trusted_internal`, and JS dispatch handles.
   - Goal: find adjacent sink with stronger primitive.
   - H17-H19 status:
     - `WasmTableObject.raw_type funcref -> externref` desynchronizes
       JS-visible `entries` from `trusted_dispatch_table`.
     - Cross-instance stale target is kept alive, not immediate UAF.
     - Incompatible stale targets still fail call-indirect sig-check.
   - H20-H24 status:
     - shorter dispatch handle OOB write is blocked by release
       `SBXCHECK_BOUNDS`;
     - longer dispatch handle + externref grow + raw_type restore injects a
       hidden callable donor dispatch entry into victim table;
     - GC roots donor target, so no immediate UAF.
   - H25-H26 status:
     - typed table import blocks generic hidden dispatch via release
       `dispatch_table->table_type()` check;
     - bad-signature hidden dispatch still traps.
   - H27 status:
     - `WasmFuncRef.trusted_internal` transplant gives real signature-confused
       execution and in-bounds Wasm memory write.
   - H28-H30 status:
     - hidden dispatch works for JS wrappers and wrapper tier-up;
     - donor refs can be dropped, GC roots callable through hidden dispatch;
     - no tier-up corruption in tested shape.
   - H29-H32 status:
     - optimized inlining guard holds;
     - `Table.set` after func-ref transplant still traps;
     - post-instantiation SFI trusted_function_data mutation is too late.
   - H33 status:
     - typed `table.get(1)+call_ref` executes visible entry;
     - typed `call_indirect(1)` executes different hidden dispatch target;
     - this is same-index execution divergence, not crash-only.
   - H34 status:
     - same divergence, but visible entry is written by normal JS
       `Table.set()` while `raw_type=externref`;
     - only field corruptions needed are `trusted_dispatch_table` and
       `raw_type`.
   - Next: combine H23 + H27 more directly, or search for a way to mutate
     `WasmImportData.sig` / dispatch `sig` without relying on table import.

## Stop conditions

- Stop C21 only after direct forge + hidden-root + reuse + GC-mode matrix are
  either confirmed or refuted.
- If all produce only inside-sandbox crash, keep as primitive and move to sibling
  sinks.
