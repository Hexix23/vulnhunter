# C21 Sandbox Sink Audit Verdict

## H1 - `WasmGlobalObject.raw_type` valid i64 -> externref

Verdict: `CONFIRMED-RELEASE-SINK-NO-CRASH`

PoC:

- `poc/h1-global-rawtype-i64-to-externref.js`

Source sink:

- `WasmGlobalObject::unsafe_type()` accepts any valid `ValueType`.
- `WebAssemblyGlobalGetValueCommon()` switches on the corrupted type.
- `WasmGlobalObject::GetRef()` reads `ObjectSlot{storage()}`.
- `storage()` only DCHECKs buffer layout consistency; release build confirms the
  getter reaches this mismatched layout.

Expected bug signal:

- A numeric global is backed by `ByteArray[8]`.
- Corrupting `raw_type` to valid `externref` makes `GetRef()` treat raw numeric
  bytes as a tagged object.

Observed in Linux sandbox DCHECK:

- DebugPrint confirms:
  - `i64` global raw type: `0x1710`
  - `externref` global raw type: `0xb05`
- H0 shows `raw_type` is Smi-tagged in memory:
  - `i64` memory field: `0x2e20`
  - `externref` memory field: `0x160a`
- First H1 run used untagged `0xb05`, causing `HAS_SMI_TAG` debug failures.
- PoC corrected to write `0x160a`.
- Corrected Linux sandbox DCHECK output:
  - `before=0`
  - `0`
- Release sandbox output matches:
  - `before=0`
  - `0`

Interpretation:

- This is not the old invalid-raw-type regression.
- Sink hypothesis remains valid, but old H1 evidence is invalid for release
  assessment because field encoding was wrong.
- Corrected H1 proves getter trusts corrupted valid type enough to read
  `ByteArray` payload as tagged object data. Zero-filled i64 storage becomes
  visible JS `0`.

## H2 - `WasmGlobalObject.raw_type` valid i64 -> externref setter

Verdict: `CONFIRMED-RELEASE-HIDDEN-REF-WRITE`

PoC:

- `poc/h2-global-rawtype-i64-set-externref.js`

Source sink:

- `WebAssemblyGlobalSetValueImpl()` uses `receiver->unsafe_type()` to choose
  setter path.
- After valid corruption to `externref`, `JSToWasmObject()` accepts arbitrary JS
  object.
- `WasmGlobalObject::SetRef()` writes with `MaybeObjectSlot{storage()}` then
  calls `WriteBarrier::ForValue(buffer(), slot, *value, UPDATE_WRITE_BARRIER)`.

Expected bug signal:

- Backing buffer is still the original `ByteArray[8]` from an `i64` global.
- Corrupted type makes setter write a tagged object pointer into numeric
  backing storage.
- GC after setter should expose whether release sandbox has a real guard or
  stale layout trust.

Observed in Linux sandbox DCHECK:

- First H2 run used untagged `0xb05`, causing wrong Smi field encoding.
- DCHECK build reports from that flawed run:
  - `tagged-field-inl.h:197: HAS_SMI_TAG(tagged_value)`
  - `wasm-objects.cc:3449: expected.is_ref()`
  - terminates at `wasm-objects.cc:3666` unreachable code.

Interpretation:

- Corrected H2 with `--expose-gc`:
  - `before=0`
  - `true`
- Release sandbox output matches:
  - `before=0`
  - `true`
- This confirms `SetRef()` stores a JS object into the original numeric
  `ByteArray` backing storage, and getter reads it back after one `gc()`.

Next chain test:

- H3 removes the normal JS reference, applies GC pressure / compaction, then
  reads the hidden pointer back. This decides whether the hidden ByteArray slot
  is a UAF/stale-pointer primitive or merely a consistent remembered slot.

## H3 - Hidden ref in ByteArray after GC/compaction

Verdict: `CONFIRMED-RELEASE-CRASH`

PoC:

- `poc/h3-global-bytearray-hidden-ref-gc.js`

Observed in Linux sandbox DCHECK:

- First read after setter prints `hidden-ref`.
- After dropping normal JS reference and applying allocation + `gc()` pressure
  under `--stress-compaction`, second read terminates:
  - `Caught harmless memory access violation (inside sandbox). Exiting process...`
- Without the sandbox-testing signal catcher, same PoC exits with real
  `SIGSEGV`:
  - `Received signal 11 SEGV_MAPERR 1f89beadbef6`
  - symbolized at `WasmToJSObject(...) -> WasmObjectToJSReturnValue(...) ->
    WebAssemblyGlobalGetValueCommon(...)` (`src/wasm/wasm-js.cc:3163`)
- Release sandbox-testing reproduces the inside-sandbox memory access violation.
- Release without sandbox-testing does not depend on DCHECKs; it prints:
  - `hidden-ref`
  - `undefined`
  - `undefined`
  then fatal-crashes with:
  - `Check failed: isolate_ == isolate.`
  - top symbolized heap frame:
    `MarkingVisitorBase<ConcurrentMarkingVisitor>::ProcessStrongHeapObject<CompressedObjectSlot>(...)`
    at `src/execution/isolate.h:1192`

Interpretation:

- `SetRef()` can create a hidden object pointer in a `ByteArray` by trusting
  corrupted valid `raw_type`.
- That hidden pointer is not kept as a stable object slot across GC/compaction.
- Current signal is release crash from GC seeing corrupted hidden ref state, but
  still not yet sandbox escape / VRP.
- Next step: chain attempt with controlled object reuse / stronger GC shaping
  to determine whether stale pointer can become type confusion instead of only
  inside-sandbox crash.

## H4 - Hidden ref stale pointer with object spray

Verdict: `CONFIRMED-INSIDE-SANDBOX-STALE-POINTER`

PoC:

- `poc/h4-global-hidden-ref-reuse.js`

Observed in Linux sandbox DCHECK:

- First read prints `initial=dead`.
- After dropping normal reference, `gc()`, object spray, and second `gc()`,
  V8 reports repeated invalid instance-type DCHECKs:
  - `LAST_TYPE >= value ... [unknown instance type -4162]`
- Then terminates:
  - `Caught harmless memory access violation (inside sandbox). Exiting process...`
- Release sandbox-testing also terminates with inside-sandbox memory access
  violation after `initial=dead`.

Interpretation:

- Spray did not yet turn stale pointer into controlled object reuse.
- It strengthens H3: stale hidden pointer is dereferenced as a heap object and
  reaches map / instance-type consumers before inside-sandbox crash.

## H5 - Direct forged externref from i64 bytes

Verdict: `CONFIRMED-RELEASE-FORGED-REFERENCE`

PoC:

- `poc/h5-global-i64-forge-externref.js`

Observed in Linux release:

- Store `Sandbox.getAddressOf(target) + kHeapObjectTag` as `BigInt` in an
  `i64` global.
- Corrupt `raw_type` to tagged `externref` Smi `0x160a`.
- Read `global.value`.
- Output:
  - `same=true`
  - `tag=forged-ref`
  - `marker=4919`

Interpretation:

- C21 is stronger than “crash-only”. The getter can manufacture a JS object
  reference from numeric `ByteArray` bytes when the attacker controls those
  bytes.
- This is still within the sandbox-corruption testing model, but it is a real
  object-reference forgery primitive over a trusted layout mismatch.

## H6 - Direct forged externref after dropping normal reference

Verdict: `CONFIRMED-RELEASE-STALE-FORGED-REFERENCE`

PoC:

- `poc/h6-global-i64-forge-stale-ref.js`

Observed in Linux release:

- Store target pointer bytes in numeric `i64` global.
- Drop normal JS reference.
- Apply allocation + `gc()` pressure under `--stress-compaction`.
- Read forged `externref`.
- Process exits with:
  - `Received signal 11 SEGV_MAPERR 2ea000a0020b`
- Symbolized frames:
  - `WasmToJSObject(...)`
  - `WasmObjectToJSReturnValue(...)`
  - `WebAssemblyGlobalGetValue(...)`, `src/wasm/wasm-js.cc:676`

Interpretation:

- H5 proves direct object-reference forgery while target is live.
- H6 proves the same forged slot becomes stale after GC when it is not a real
  traced pointer slot.
- Next expansion should focus on controlled reuse and object-kind/GC-mode
  matrix, not stop at the crash.

## H7 - Live forged-reference object-kind matrix

Verdict: `CONFIRMED-RELEASE-GENERAL-FORGED-REFERENCE`

PoC:

- `poc/h7-global-forge-live-kind-matrix.js`

Observed in Linux release:

- `object:same=true:obs=obj`
- `array:same=true:obs=true:3:22`
- `function:same=true:obs=function:77`
- `arraybuffer:same=true:obs=16`
- `typedarray:same=true:obs=3:9`
- `stringobject:same=true:obs=abc:3`

Interpretation:

- Direct forged reference is not limited to one object shape.
- It works for ordinary objects, arrays, functions, ArrayBuffers, TypedArrays,
  and String objects while the target remains live.

## H8 - Stale forged-reference object-kind matrix

Verdict: `CONFIRMED-RELEASE-KIND-DEPENDENT-STALE-BEHAVIOR`

PoC:

- `poc/h8-global-forge-stale-kind-case.js`

Observed in Linux release:

- `object`: stale read becomes `undefined:undefined`, then fatal
  `unreachable code`.
- `array`: stale read reaches `<FreeSpace[184]>` and aborts during observation.
- `function`: stale read reaches `<Other heap object (FILLER_TYPE)>` and aborts
  with `Unexpected instance type encountered`.
- `arraybuffer`: stale read becomes `undefined`.
- `typedarray`: stale read remains usable: `after=2:771`.
- `stringobject`: stale read throws `TypeError:value.valueOf is not a function`.

Interpretation:

- Stale behavior is kind-dependent.
- `typedarray` is the next best chain candidate because it stayed usable after
  GC pressure in this run.

## H9 - WeakRef liveness vs stale forged pointer

Verdict: `CONFIRMED-RELEASE-UNTRACKED-RELOCATION-STALE-POINTER`

PoC:

- `poc/h9-global-forge-weakref-liveness.js`

Observed in Linux release:

- `typedarray`:
  - WeakRef still derefs the original target.
  - Forged stale read then crashes in `WasmToJSObject(...)`.
- `object`:
  - WeakRef still derefs the original target.
  - Forged stale read becomes `undefined:undefined`, then fatal
    `unreachable code`.
- `arraybuffer`:
  - WeakRef still derefs the original target.
  - Forged stale read points at an `INTERNALIZED_TWO_BYTE_STRING_TYPE`, then
    aborts when observed as ArrayBuffer.

Interpretation:

- This is not only "object collected, pointer freed".
- WeakRef shows target can remain logically live, while the raw pointer stored
  in numeric `ByteArray` is not updated by compaction/relocation.
- The primitive is more precise: untracked tagged pointer in non-pointer storage
  becomes stale after GC relocation.

## H10 - TypedArray stale ref read/write check

Verdict: `CONFIRMED-RELEASE-RELOCATION-STALE-CRASH`

PoC:

- `poc/h10-typedarray-stale-rw.js`

Observed in Linux release:

- Even with `H10_ROUNDS=0` and no explicit allocation pressure:
  - old forged address differs from WeakRef-live current address.
  - `moved=true`
  - dereferencing `global.value` crashes in `WasmToJSObject(...)`.
- With one `gc()` and with `--stress-compaction`, same pattern.

Interpretation:

- TypedArray does not provide stable stale RW as-is.
- It confirms relocation-stale root cause: forged bytes are not updated when
  the object moves.

## H11 - Refresh forged ref after relocation

Verdict: `CONFIRMED-RELEASE-REFRESHABLE-FORGED-REFERENCE`

PoC:

- `poc/h11-refresh-forged-ref-after-relocation.js`

Observed in Linux release:

- `old=0x1077331`
- `new=0x10a4bfd`
- `moved=true`
- After flipping `raw_type` back to `i64`, writing the new address, and flipping
  to `externref`:
  - `same=true`
  - `rec=4:43690:56797`
  - `write=305419896:305419896`

Interpretation:

- Relocation is the reason stale forged refs crash.
- If the attacker refreshes the numeric bytes to the relocated address, forged
  ref works again and TypedArray writes reach the real object.
- This is still inside the sandbox model, but it is a controlled object-ref
  primitive, not a passive crash.

## H12 - TypedArray SandboxedPtr redirect

Verdict: `CONFIRMED-IN-SANDBOX-RW-ONLY`

PoC:

- `poc/h12-typedarray-sandboxedptr-redirect.js`

Observed in Linux release:

- Copy encoded `JSArrayBuffer.backing_store` from buffer B into
  `JSTypedArray.external_pointer` for view A.
- Output:
  - `before_va0=17`
  - `before_vb0=66`
  - `after_va0=66`
  - `after_vb1=153`

Interpretation:

- This gives a clean JS-level RW primitive over arbitrary in-sandbox backing
  stores.
- It does not escape sandbox by itself: fields are `SandboxedPtr`, decoded as
  `Sandbox.base + offset`.
- Escape candidates must target `ExternalPointer` handles (`JSArrayBuffer.extension`)
  or trusted/dispatch tables, not plain backing_store/external_pointer fields.

## H13-H16 - ArrayBuffer extension handle chain

Verdict: `PARTIAL-EXTERNAL-METADATA-CONFUSION-NO-ESCAPE-YET`

PoCs:

- `poc/h13-arraybuffer-extension-handle-transplant.js`
- `poc/h14-arraybuffer-extension-alias-transfer.js`
- `poc/h15-arraybuffer-extension-alias-lifecycle.js`
- `poc/h16-arraybuffer-extension-invalid-handle.js`

Observed in Linux release:

- H13: copying `b.extension` handle into `a.extension`, then `a.transfer()`,
  produces transferred buffer containing `b` data (`transfer_ok=16:66`).
- H14: after first transfer, transferred buffer and `b` alias:
  - `alias_after_write=153:153`
  - `b.transfer()` then detaches `b` and creates `b2`.
- H15: after second transfer, `t1` and `t2` no longer alias and survive GC.
- H16: invalid extension handles:
  - `zero`, `plus4`, `xor` still let `transfer()` complete.
  - `0xffffffff` crashes in `JSArrayBuffer::GetBackingStore()` /
    `ArrayBufferTransfer(...)`.

Interpretation:

- `JSArrayBuffer.extension` is a real external-pointer-handle attack surface,
  unlike SandboxedPtr fields.
- Same-tag handle transplant creates transient JS-visible backing-store alias.
- Current tests did not produce persistent UAF or sandbox escape.
- Next useful branch is trusted/dispatch table sinks, because ArrayBuffer
  extension path has guards/semantics that collapse to alias/crash so far.

## H17-H19 - `WasmTableObject.raw_type` entries / dispatch desync

Verdict: `CONFIRMED-TRUSTED-DISPATCH-DESYNC-NO-SIG-BYPASS`

PoCs:

- `poc/h17-table-rawtype-externref-dispatch-desync.js`
- `poc/h18-table-stale-dispatch-cross-instance-gc.js`
- `poc/h19-table-stale-dispatch-sigcheck.js`

Source sink:

- `WasmTableObject::unsafe_type()` validates only `ValueType::is_valid()`.
- `WebAssemblyTableSetImpl()` validates the JS value against corrupted
  `unsafe_type()`.
- `WasmTableObject::Set()` updates `entries` only for `externref`, but
  updates/clears `trusted_dispatch_table` only for `funcref`.
- `call_indirect` consumes the trusted dispatch table, not the JS-visible
  `entries` value.

Observed in Linux release:

- H17:
  - `funcref_raw=0x124a`
  - `externref_raw=0x160a`
  - after corrupting funcref table `raw_type` to externref, `table.set(0,
    marker)` makes `table.get(0) === marker`, but `call_indirect` still returns
    the previous function result.
  - `table.set(0, null)` makes `table.get(0) === null`, but `call_indirect`
    still calls the previous function.
- H18:
  - Cross-instance target remains callable after JS entry is nulled and normal
    JS refs to target instance/function are dropped.
  - `WeakRef` shows target function and instance remain alive:
    `weak_target_alive=true`, `weak_instance_alive=true`.
- H19:
  - Incompatible stale dispatch entry remains blocked:
    `RuntimeError:function signature mismatch` before and after hiding the entry
    with corrupted externref `raw_type`.

Interpretation:

- This is a stronger sibling sink than H1-H16: in-sandbox `raw_type`
  corruption can desynchronize JS-visible table entries from trusted dispatch
  state.
- It crosses from sandbox-controlled metadata into trusted dispatch behavior:
  `entries` says object/null while `trusted_dispatch_table` still authorizes and
  invokes an older function.
- Current impact is not yet sandbox escape:
  - target instance/function are kept alive, so no UAF in H18;
  - call-indirect signature verification still blocks incompatible stale
    targets in H19.
- Next branch should target dispatch-table handle lifetime/transplant or
  signature metadata mutation, not plain `entries` desync.

## H20-H24 - `trusted_dispatch_table` transplant + grow + raw_type chain

Verdict: `CONFIRMED-HIDDEN-DISPATCH-INJECTION-NO-UAF`

PoCs:

- `poc/h20-dispatch-table-length-mismatch-call.js`
- `poc/h21-dispatch-table-length-mismatch-set.js`
- `poc/h22-grow-copies-stale-dispatch-under-externref.js`
- `poc/h23-grow-stale-dispatch-new-import.js`
- `poc/h24-hidden-dispatch-injection-liveness.js`

Source sink / guards:

- `WasmTableObject::Grow()` grows `trusted_dispatch_table` if present, but
  release guards are in `WasmDispatchTable::Grow()`.
- `WasmDispatchTable::{SetForNonWrapper,SetForWrapper,Clear}` all use
  `SBXCHECK_BOUNDS(index, dispatch_table->length())`
  (`src/wasm/wasm-objects.cc:2386`, `2460`, `2528`).
- `WasmDispatchTable::Grow()` checks trusted old length vs requested new length:
  `SBXCHECK_LT(old_length, new_length)`.

Observed in Linux release:

- H20:
  - Transplanting a shorter dispatch-table handle into a larger JS table did
    not affect an already-instantiated indirect caller in that shape:
    `after1=39`.
  - Interpretation: the caller/import path did not consult the modified JS
    table handle for this direct call shape.
- H21:
  - Transplant shorter handle into larger table, then call `big.set(1, f1)`.
  - Release sandbox safely terminates on:
    `Check failed: ... index < ... dispatch_table->length()`.
  - Direct trusted-table OOB write is guarded.
- H22:
  - Transplant longer donor dispatch table into shorter victim, corrupt victim
    raw_type to externref, then `victim.grow(2, marker)`.
  - Existing importer still reports table index out of bounds for new indices.
- H23:
  - Same grow shape, then restore victim raw_type to funcref and instantiate a
    new importer.
  - `victim.get(1)` while raw_type is externref was `marker`, but new importer
    calls donor dispatch entry at index 1:
    `new_after1=39`.
  - Index 2 traps `RuntimeError:null function`.
- H24:
  - Drop donor table / normal target refs and force GC.
  - WeakRefs stay alive and hidden dispatch remains callable:
    `weak_instance_alive=true`, `weak_f1_alive=true`, `after_gc=39`.

Interpretation:

- H23 is a real hidden dispatch injection primitive:
  - JS-visible `entries[1]` is attacker marker object;
  - trusted dispatch entry at index 1 came from donor table;
  - a fresh Wasm importer can call donor function through victim table.
- H21 blocks the obvious trusted-table OOB write.
- H24 shows no immediate UAF: trusted dispatch state roots the target.
- Still not VRP-grade escape by itself. It is useful chain material because it
  creates callable trusted state that JS table state cannot explain. Next step:
  combine hidden dispatch injection with signature metadata mutation or
  `WasmFuncRef.trusted_internal`/wrapper call-origin mutation.

## H25-H26 - Typed import and bad-signature guard checks

Verdict: `REFUTED-BYPASS-GUARDS-HOLD`

PoCs:

- `poc/h25-hidden-dispatch-typed-table-import.js`
- `poc/h26-hidden-dispatch-generic-bad-sig.js`

Observed in Linux release:

- H25:
  - Generic donor dispatch state injected into a typed victim table.
  - JS-visible new entry is still marker: `entry1_is_marker=true`.
  - Importing victim as a typed table safely terminates at:
    `Check failed: dispatch_table->table_type() == module_->canonical_type(table.type).`
- H26:
  - Generic hidden dispatch injection with donor entry whose signature is
    incompatible with the caller.
  - Index 0 works: `after0=23`.
  - Index 1 traps: `RuntimeError:function signature mismatch`.

Interpretation:

- H25 blocks generic dispatch-table state from being imported as typed table.
- H26 blocks the simple bad-signature hidden dispatch call.
- These are useful negative results: the remaining promising route is not
  table import/signature matching, but `WasmFuncRef.trusted_internal` or wrapper
  metadata where target and signature can diverge before dispatch table install.

## H27 - `WasmFuncRef.trusted_internal` in-bounds signature confusion

Verdict: `CONFIRMED-WASM-SIGNATURE-CONFUSION-BOUNDED`

PoC:

- `poc/h27-funcref-internal-transplant-inbounds-write.js`

Source sink:

- `WasmFuncRef.trusted_internal` is an in-sandbox trusted-pointer handle.
- `call_ref` ultimately consumes the referenced `WasmInternalFunction`.
- The handle can be transplanted from a function with a different signature.

Observed in Linux release:

- Before corruption:
  - `before_ret=7`
  - `before_mem0=0x0`
- After transplanting `func0(i32)->i32` internal handle into the func ref for
  `func1(i64)->i32`, calling as `func1` executes `func0`:
  - `after_ret=0x55`
  - `after_mem0=0x41414141`

Interpretation:

- This is not just a crash: it is concrete signature-confused execution.
- Current impact is bounded by Wasm memory checks. The wrong body can perform
  attacker-controlled in-bounds Wasm memory accesses, but tested shape does not
  escape the sandbox.
- This primitive is the best current partner for H23 hidden dispatch injection:
  use table/grow desync to install callable hidden state, then use
  `trusted_internal`/wrapper metadata to diverge target, sig, and implicit_arg.

## H28-H30 - Hidden JS wrapper dispatch + tier-up + lifetime

Verdict: `CONFIRMED-HIDDEN-JS-WRAPPER-DISPATCH-ROOTED-TIERUP-SAFE`

PoCs:

- `poc/h28-hidden-js-wrapper-tierup.js`
- `poc/h30-hidden-js-wrapper-tierup-after-gc.js`

Observed in Linux release:

- H28:
  - hidden entry JS-visible state: `entry1_is_marker=true`
  - hidden JS wrapper is called: `call1=117`, `call2=118`
  - generic wrapper tiers up: `unopt_before=1`, `unopt_after1=0`
- H30:
  - donor table / JS function refs dropped, GC pressure applied.
  - hidden dispatch roots callable: `weak_jsfunc_alive=true`
  - wrapper still tiers up and calls JS: `call1=149`, `call2=150`

Interpretation:

- Hidden dispatch injection also works for `WebAssembly.Function` /
  `WasmJSFunction` entries.
- Runtime wrapper tier-up survives the hidden/rebound state in release.
- This does not escape: it preserves a hidden rooted callable and performs
  expected wrapper tier-up.
- The `call_origin/table_slot` checks in `Runtime_TierUpWasmToJSWrapper` are
  DEBUG-only for table origins, but in tested shapes release behavior remains
  coherent.

## H29 - Optimized `trusted_internal` inlining guard

Verdict: `REFUTED-OPTIMIZED-INLINE-GUARD-HOLDS`

PoC:

- `poc/h29-funcref-internal-transplant-tierup-inbounds.js`

Observed in Linux release:

- Feedback is collected for a valid `call_ref`.
- After `trusted_internal` transplant and map corruption, tier-up safely
  terminates at:
  `Check failed: InlineTargetIsTypeCompatible(decoder->module_, sig, inlinee.sig).`

Interpretation:

- H27 signature-confused execution exists in the non-inlined path.
- The optimized inlining path has a release sandbox check and does not inline
  the wrong target in this shape.

## H31-H32 - Table.set and post-instantiation SFI mutation

Verdict: `REFUTED-LATE-MUTATION-GUARDS-HOLD`

PoCs:

- `poc/h31-table-set-after-funcref-internal-transplant.js`
- `poc/h32-post-instantiation-trusted-function-data-mutation.js`

Observed in Linux release:

- H31:
  - After corrupting the cached `WasmFuncRef.trusted_internal`, calling
    `WebAssembly.Table.set(1, exported func1)` still results in:
    `RuntimeError:function signature mismatch`.
- H32:
  - Mutating `SharedFunctionInfo.trusted_function_data` after the import has
    been instantiated does not affect later calls or tier-up:
    `after_mut_call_mem0=0x32323232`, `after_tierup_mem0=0x32323232`.

Interpretation:

- `Table.set` after func-ref internal transplant does not produce a useful
  target/sig mismatch in this shape.
- Post-instantiation SFI trusted-function-data mutation is too late: dispatch
  and import state already carry copied trusted state.
- Any `trusted_function_data` bug needs the instantiation race window or a
  different protected-data mutation point.

## H33 - visible entry vs hidden dispatch divergence

Verdict: `CONFIRMED-WASM-TABLE-INTEGRITY-VIOLATION-SANDBOX-MODEL`

PoC:

- `poc/h33-visible-entry-hidden-dispatch-divergence.js`

Observed in Linux release:

- Typed donor table slot 1 hidden dispatch target returns `arg + 0x20`.
- Victim table slot 1 JS/Wasm-visible entries array is overwritten with a valid
  `WasmFuncRef` for a different same-signature function returning `arg + 0x70`.
- Same imported typed table, same index:
  - `call_ref_entry1=117`
  - `call_indirect_entry1=37`
- The same result reproduces without `--experimental-wasm-type-reflection`.

Observed in Linux dcheck:

- Same divergence survives.
- Dcheck build reports the violated invariant at
  `src/wasm/wasm-objects.cc:291`:
  `old_size == dispatch_table->length() (1 vs. 2)`.

Interpretation:

- `table.get(1)` followed by `call_ref` executes the visible entry.
- `call_indirect(1)` executes the stale hidden dispatch entry.
- This is a concrete integrity violation between `WasmTableObject.entries` and
  `WasmDispatchTable`, not merely a crash.
- Current limitation remains the same as H23/H27: PoC uses the sandbox
  memory-corruption API to corrupt in-sandbox table metadata. Impact is stronger
  than the previous crash-only paths, but still needs either a natural
  corruption source or a stronger sandbox-boundary consequence for final VRP.

## H34 - same divergence, visible entry written through JS API

Verdict: `CONFIRMED-WASM-TABLE-INTEGRITY-VIOLATION-SANDBOX-MODEL`

PoC:

- `poc/h34-visible-entry-via-jsapi-hidden-dispatch.js`

Observed in Linux release without experimental flags:

- `visible_direct=117`
- `victim_get1_is_visible=true`
- `call_indirect_entry1=37`

Observed in Linux dcheck:

- Same divergence.
- Same violated invariant:
  `src/wasm/wasm-objects.cc:291`
  `old_size == dispatch_table->length() (1 vs. 2)`.

Interpretation:

- H34 is cleaner than H33: it does not directly write the `FixedArray` entry.
- The PoC only corrupts the table `trusted_dispatch_table` handle and
  `raw_type`, then uses normal `victim.grow()` and `victim.set()` JS APIs.
- While `raw_type=externref`, `victim.set(1, visible)` updates only the
  JS-visible entries array. The hidden dispatch table is not updated.
- After restoring typed funcref raw type, JS API says slot 1 is `visible`, but
  Wasm indirect call executes the stale hidden dispatch target.
