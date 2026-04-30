# C21 Walkthrough - WasmGlobalObject.raw_type Sink

## Why this sink

The old C7 path depended on `--experimental-wasm-shared`, so it was not a
default/release VRP path. C21 switches to sink-first analysis: start from
corruptible sandbox fields, then identify first trusted consumers.

Primary sink:

- `WasmGlobalObject.raw_type` is a sandbox-corruptible `Smi`.
- `unsafe_type()` reconstructs `ValueType` from this field.
- JS API getter/setter choose numeric vs ref access based on `unsafe_type()`.
- `storage()` only has DCHECK layout checks that the selected type matches
  `ByteArray` vs `FixedArray`.

## Important correction

Initial H1/H2 used `0xb05`, taken from DebugPrint `externref (raw=0xb05)`.
That was wrong for direct field corruption: the in-object field stores a tagged
Smi.

H0 reads the actual memory field:

- `i64` DebugPrint raw `0x1710`, memory field `0x2e20`
- `externref` DebugPrint raw `0xb05`, memory field `0x160a`

Corrected PoCs use `0x160a`.

## Results

H1 getter:

- Create mutable `i64` global, backed by `ByteArray[8]`.
- Corrupt `raw_type` to tagged externref Smi `0x160a`.
- `global.value` returns `0`.
- Meaning: getter reads numeric `ByteArray` payload as tagged ref data.
- Confirmed on release sandbox build.

H2 setter:

- Same corrupted global.
- Assign JS object to `global.value`.
- Setter accepts object as `externref` and `SetRef()` writes it through
  `MaybeObjectSlot{storage()}` into original `ByteArray`.
- After `gc()`, getter returns same object.
- Confirmed on release sandbox build.

H3 stale pointer:

- Store object through H2 path.
- Drop normal JS reference.
- Allocate and force GC/compaction.
- Later getter dereferences hidden `ByteArray` pointer and exits with:
  `Caught harmless memory access violation (inside sandbox).`
- Without the sandbox-testing signal catcher, same PoC hits `SIGSEGV` in
  `WasmToJSObject -> WasmObjectToJSReturnValue -> WebAssemblyGlobalGetValueCommon`.
- Confirmed on release sandbox build:
  - sandbox-testing catches inside-sandbox memory access violation,
  - no-catcher release run later fatal-crashes during mark-compact with
    `Check failed: isolate_ == isolate` in `ProcessStrongHeapObject`.

H4 reuse attempt:

- Adds object spray before second read.
- Still becomes invalid instance-type / inside-sandbox memory violation.
- No controlled object reuse yet.

Expansion plan:

- `CHAIN_PLAN.md` defines mandatory next ladder: direct forge-ref,
  hidden-root/stale-root, reuse shaping, object-kind matrix, GC-mode matrix,
  sibling sinks.
- H5 confirms direct forged JS reference from numeric `i64` bytes.
- H6 confirms stale forged reference after dropping normal ref and forcing GC.
- H7 confirms forged references work across object kinds.
- H8/H9 show stale behavior is kind-dependent and caused by untracked pointer
  relocation, not just object collection.

## Current judgment

This is not a replay of existing invalid-raw-type regression. It is a valid
type confusion on a valid `raw_type` encoding:

- type says ref
- storage is still numeric `ByteArray`
- setter creates hidden object pointer in non-pointer storage
- GC later leaves stale pointer

Current impact is release crash/stale hidden pointer under sandbox corruption
model. Not VRP yet. Need either:

- release confirmation,
- controlled reuse/type confusion,
- or chain to out-of-sandbox read/write / sandbox violation.

## Sibling sink: WasmTableObject.raw_type

After H12-H16 showed plain `SandboxedPtr` fields stay in-cage and ArrayBuffer
extension handle transplants collapse to alias/crash, the next higher-value
branch was a trusted dispatch sink.

`WasmTableObject::Set()` has a split responsibility:

- for `funcref`, it updates/clears `trusted_dispatch_table`;
- for `externref`/other refs, it only writes `entries`.

H17 corrupts a funcref table `raw_type` to valid externref. JS API then accepts
an arbitrary object or `null` for `table.set(0, ...)`. `table.get(0)` reflects
that object/null, but `call_indirect` still calls the previously installed
function through stale trusted dispatch state.

H18 moves this across instances and drops normal JS references to the target.
The target function and instance remain alive after GC, so this is a hidden root
rather than a UAF in that shape.

H19 tests the obvious escape route: install an incompatible function, hide it by
changing the entry to `null`, then call through the stale dispatch entry. V8
still traps with `RuntimeError:function signature mismatch`, so the signature
guard holds.

Current judgment:

- H17-H19 are real trusted-state desync primitives.
- They are stronger than crash-only, because JS-visible table state and trusted
  dispatch behavior diverge in release.
- They are not yet VRP-grade sandbox escape because lifetime and signature
  checks still hold in tested shapes.
- Continue with `trusted_dispatch_table` handle lifetime/transplant and
  signature metadata mutation; stop spending cycles on plain object/null entry
  desync.

## Trusted dispatch transplant chain

H20-H24 tested whether the table desync can be amplified through the trusted
dispatch table handle.

H20 transplanted a shorter dispatch table handle into a larger JS table and
called through an already-instantiated importer. No effect in that shape:
`after1=39`. This suggests the direct call path was using importer-local state
or cached dispatch state rather than the modified JS table handle.

H21 targeted the direct writer instead: after transplanting a shorter handle
into a larger table, `Table.set(1, f1)` reached
`WasmDispatchTable::SetFor*` and release sandbox killed the process at
`SBXCHECK_BOUNDS(index, dispatch_table->length())`. This is a real guard, not
debug-only.

H22/H23 found the useful path:

- donor table length 2 has dispatch entries `f0`, `f1`;
- victim table length 1 receives donor `trusted_dispatch_table` handle;
- victim `raw_type` is corrupted to valid `externref`;
- `victim.grow(2, marker)` grows trusted dispatch state and writes marker
  objects into new JS-visible entries without clearing copied dispatch entries;
- victim `raw_type` is restored to funcref;
- a fresh importer of victim table can call index 1 and reaches donor `f1`
  even though the JS entry was marker when initialized.

H24 drops ordinary donor refs and forces GC. WeakRefs remain alive and
`call(1, 7)` still returns the donor result. So this is hidden trusted dispatch
injection with rooting, not UAF.

Current judgment:

- Strong primitive: callable trusted dispatch state can be injected behind
  JS-visible marker entries.
- Guarded paths: shorter-table OOB write and incompatible signature call.
- Still no sandbox escape. The next high-signal chain is to combine this with
  signature metadata mutation or `WasmFuncRef.trusted_internal` so the injected
  callable entry crosses a signature/implicit-arg boundary.

## Guard checks after hidden dispatch injection

H25 tests the typed-table route: inject a generic donor dispatch table into a
typed victim table, restore victim raw_type to the typed function type, then
import victim into a typed caller. V8 safely terminates in release at the
import-time dispatch-table type check:

`dispatch_table->table_type() == module_->canonical_type(table.type)`

H26 keeps the import generic but makes donor index 1 an incompatible function.
The hidden entry is present, but call time still traps with
`RuntimeError:function signature mismatch`.

These are useful refutations. They show that H23 does not become a signature
bypass through table import alone.

## WasmFuncRef.trusted_internal

H27 moves to the adjacent sink the table path points toward. It transplants
`func0(i32)->i32` into the `WasmFuncRef` for `func1(i64)->i32`, then calls
through the `func1` call_ref path with `0n`.

Observed:

- before: `before_ret=7`, `before_mem0=0x0`
- after: `after_ret=0x55`, `after_mem0=0x41414141`

This confirms concrete signature-confused execution in release. It is bounded
by Wasm memory checks in this shape, but it is not a passive crash. This is now
the best partner primitive for H23:

- H23: hidden callable dispatch entry under wrong JS-visible table state.
- H27: wrong body executes under wrong call_ref signature.

Next chain should target imported-wrapper metadata / `WasmImportData.call_origin`
or tier-up/inlining shapes where wrong `implicit_arg` makes memory or signature
metadata point outside normal Wasm linear memory semantics.

## Wrapper / Tier-Up Variants

H28 puts a `WebAssembly.Function` into the donor table before the hidden
dispatch injection. The victim entry is marker-visible during grow, then a fresh
importer calls index 1. The generic Wasm-to-JS wrapper tiers up cleanly:

- `unopt_before=1`
- `call1=117`
- `unopt_after1=0`
- `call2=118`

H30 drops the donor table and JS function refs and applies GC before import and
tier-up. The hidden dispatch state roots the JS function:

- `weak_jsfunc_alive=true`
- `call1=149`
- `call2=150`

This confirms hidden dispatch injection works with JS wrappers and wrapper
tier-up, but the tested path stays coherent. The DEBUG-only table-origin checks
in `Runtime_TierUpWasmToJSWrapper` did not imply a release bug in this shape.

## Optimized trusted_internal Variant

H29 tests the optimized/inlining version of H27. It collects feedback, corrupts
`trusted_internal`, corrupts the map to pass the cast shape, then tiers up. V8
release sandbox terminates before wrong inlining:

`InlineTargetIsTypeCompatible(decoder->module_, sig, inlinee.sig)`

So H27 remains a real bounded signature-confused execution primitive in the
non-inlined path, while the optimized inline path is guarded.

## Late Mutation Variants

H31 tries to feed the corrupted cached func ref back through `Table.set`.
Result: `RuntimeError:function signature mismatch`.

H32 mutates `SharedFunctionInfo.trusted_function_data` after import
instantiation. Calls and tier-up still use the already-copied import/dispatch
state; memory writes remain from the original writer.

Current refined map:

- promising primitives:
  - H23/H24 hidden dispatch injection;
  - H27 bounded `trusted_internal` signature-confused execution.
- strong guards:
  - H21 dispatch-table bounds;
  - H25 typed table import `table_type`;
  - H26 call-time signature check;
  - H29 optimized inline compatibility.
- weak/closed branches:
  - H28/H30 wrapper tier-up is coherent;
  - H31 `Table.set` after func-ref corruption traps;
  - H32 post-instantiation SFI mutation too late.

## Visible entry vs hidden dispatch divergence

H33 makes H23 more security-relevant without changing signatures. It uses typed
tables on both sides so import-time `table_type` checks pass, then creates a
victim state where:

- `entries[1]` is a valid `WasmFuncRef` for a visible function returning
  `arg + 0x70`;
- `trusted_dispatch_table[1]` still points at the hidden donor function
  returning `arg + 0x20`.

The same imported table and index then diverge:

- `call_ref(table.get(1), 5)` returns `117`;
- `call_indirect(1, 5)` returns `37`.

Dcheck also names the invariant V8 relies on:

- `src/wasm/wasm-objects.cc:291`
- `old_size == dispatch_table->length() (1 vs. 2)`

This is stronger than H23 because the visible entry is not a marker object or
invalid function-table value. It is a valid same-signature Wasm function ref,
yet V8 executes a different hidden trusted dispatch target for indirect calls.

Current reportability judgment:

- Real invariant break: visible table state and trusted dispatch state disagree
  in a way that changes execution.
- Still sandbox-model only: requires memory-corruption API to build the state.
- Next useful work is not another crash probe; it is finding a normal-input
  corruption source for `raw_type` / `trusted_dispatch_table`, or turning this
  divergence into trusted-table OOB / out-of-sandbox access.

H34 reduces the artificial part further. Instead of directly writing
`entries[1]`, it keeps `raw_type=externref` and calls the normal JS API:

- `victim.grow(2, null)`;
- `victim.set(1, visible)`;
- `victim.get(1) === visible`.

Then it restores typed funcref raw type and imports the table. Result:

- `visible_direct=117`;
- `victim_get1_is_visible=true`;
- `call_indirect_entry1=37`.

So the visible entry is installed by ordinary V8 table API, while the hidden
dispatch target remains stale because the table type was temporarily corrupted.
This is the cleanest C21 artifact so far for a sandbox hardening report.
