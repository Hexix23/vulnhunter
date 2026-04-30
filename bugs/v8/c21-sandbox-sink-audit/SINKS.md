# C21 V8 Sandbox Sink Audit

Goal: stop replaying upstream PoCs and analyze corruptible sandbox fields as
first-class sinks.

## Method

For each sink:

- corruptible field inside sandbox
- first trusted / unsafe consumer
- guard that should stop the corrupted value
- existing regression tests
- new variant shape

## Sink Map

### S1 - `WasmGlobalObject.raw_type`

Field:

- `src/wasm/wasm-objects.tq`: `raw_type: Smi`
- Exposed to sandbox corruption by `Sandbox.corruptObjectField(global, "raw_type", ...)`.

First consumers:

- `src/wasm/wasm-objects-inl.h:86-96`
  `WasmGlobalObject::unsafe_type()` converts `raw_type` to `ValueType` and
  only checks `type.is_valid()`.
- `src/wasm/wasm-js.cc:3138-3168`
  `WebAssemblyGlobalGetValueCommon()` switches on corrupted `unsafe_type`.
- `src/wasm/wasm-objects-inl.h:129-132`
  `GetRef()` reads `ObjectSlot{storage()}`.
- `src/wasm/wasm-objects-inl.h:168-174`
  `storage()` chooses ByteArray vs FixedArray bounds by `unsafe_type()`.

Guard:

- `SBXCHECK(type.is_valid())` catches invalid raw encodings.
- Buffer-kind consistency is protected only by DCHECKs in `storage()` /
  `GetRef()`.

Existing upstream test:

- `test/mjsunit/sandbox/regress/regress-469759459.js`
  corrupts a ref global to invalid raw type `0x747`.

New variant:

- Valid but semantically false type:
  create an `i64` global backed by `ByteArray[8]`, corrupt `raw_type` to valid
  `externref` (`raw=0xb05`, Smi field bytes `0x160a`), then trigger
  `global.value`.
- Expected sink: `GetRef()` treats numeric backing bytes as an object pointer.

Status:

- H0 confirms field encoding:
  - `i64` DebugPrint raw `0x1710`, memory field `0x2e20`
  - `externref` DebugPrint raw `0xb05`, memory field `0x160a`
- H1 first run used untagged `0xb05`; corrected PoC now uses `0x160a`.
- Corrected H1 needs release-sandbox confirmation.
- H2 created for the write sink: after the same valid type corruption, setter
  calls `SetRef()` and writes a tagged object through `MaybeObjectSlot` into
  storage that was allocated as numeric `ByteArray`.

### S2 - `WasmTableObject.raw_type`

Field:

- `src/wasm/wasm-objects.tq`: `raw_type: Smi`

First consumers:

- `src/wasm/wasm-objects-inl.h:568-578`
  `WasmTableObject::unsafe_type()` validates raw encoding.
- `src/wasm/wasm-objects.cc:329-336`
  `JSToWasmElement()` uses corrupted type for JS-to-Wasm element checks.
- `src/wasm/wasm-objects.cc:380-429`
  `Set()` decides whether to update dispatch table or plain entries.
- `src/wasm/wasm-js.cc:2630-2785`
  JS API `grow/get/set/type` call into the corrupted type.

Existing upstream tests:

- `test/mjsunit/sandbox/wasm-table-sigcheck.js`
- `test/mjsunit/sandbox/wasm-table-wasmjsfunction.js`
- These cover valid signature substitution and import-time signature confusion.

New variants:

- Valid abstract type swap (`funcref`/`externref`/`anyref`) where `Set()` does
  or skips `SetFunctionTableEntry()` unexpectedly.
- Table API error paths that call `unsafe_type().name()` after length/current
  length corruption.

Status:

- H17 confirms valid `funcref -> externref` corruption creates a trusted
  dispatch desync:
  - JS-visible `entries[0]` can become arbitrary object or `null`;
  - `call_indirect` still invokes the stale trusted dispatch entry.
- H18 confirms cross-instance stale dispatch is a hidden root, not immediate
  UAF: target function and target instance stay alive after GC.
- H19 confirms call-indirect signature verification still blocks incompatible
  stale targets.
- H20-H24 pivoted to `trusted_dispatch_table` handle transplant:
  - direct shorter-handle OOB write is blocked by `SBXCHECK_BOUNDS`;
  - combined longer-handle transplant + externref grow + raw_type restore
    injects a hidden callable donor dispatch entry into a victim table;
  - GC keeps donor target alive, so no immediate UAF.
- Useful next step is signature metadata / wrapper call-origin mutation, not
  more plain `raw_type` object/null tests.

### S3 - `WasmFuncRef.trusted_internal`

Field:

- `src/wasm/wasm-objects.tq`: `trusted_internal:
  TrustedPointer<WasmInternalFunction>`

First consumers:

- `WasmFuncRef::internal()` resolves a trusted pointer handle.
- Call-ref / table / inlining paths consume the internal function signature and
  call target.

Existing upstream tests:

- `test/mjsunit/sandbox/wasm-signature-verification.js`
- `test/mjsunit/sandbox/wasm-inlining-sigcheck.js`

New variants:

- Mutate after tier-up / deopt boundary rather than before direct call.
- Cross-module canonical-type collision where signature check sees equivalent
  canonical type but callee body expects different GC shape.

Status:

- H27 confirms `trusted_internal` transplant can produce real signature-confused
  execution, not just crash:
  `func0(i32)->i32` executes through a `func1(i64)->i32` call_ref and writes
  `0x41414141` to Wasm memory.
- Current impact is bounded by Wasm memory checks.
- H29 confirms optimized/inlined call_ref has a release guard:
  `InlineTargetIsTypeCompatible`.
- H31 confirms feeding the corrupted cached func ref through `Table.set` still
  ends in call-time signature mismatch.
- Next useful variants:
  - combine with H23 hidden dispatch injection;
  - use imported JS wrapper / `WasmImportData.call_origin` so wrong
    `implicit_arg` targets metadata, not normal Wasm memory;
  - test tier-up/inlining after collecting feedback, because upstream
    `wasm-inlining-sigcheck.js` guards one optimized shape.

### S4 - `WasmTableObject.trusted_dispatch_table`

Field:

- `src/wasm/wasm-objects.tq`: `trusted_dispatch_table:
  TrustedPointer<WasmDispatchTable>`

First consumers:

- table grow / set / indirect call dispatch table update paths.

Existing upstream tests:

- `test/mjsunit/sandbox/regress/regress-446113730.js`
- `test/mjsunit/sandbox/regress/regress-452605803.js`

New variants:

- Dispatch-table handle transplant across shared vs per-isolate table.
- Grow-after-transplant without reclaim primitive, looking for missing tag/range
  check rather than repeating the known CPT reclaim chain.

Status:

- H20 direct call path did not consume modified JS table handle for an existing
  importer.
- H21 confirmed release `SBXCHECK_BOUNDS` stops shorter-table handle OOB write
  through `Table.set`.
- H23 confirmed longer-table handle transplant can be amplified by grow under
  corrupted externref raw_type:
  a new importer calls donor dispatch entry at victim index whose JS entry is a
  marker object.
- H24 confirmed hidden donor target remains rooted after GC.
- H25 confirms typed import checks dispatch-table `table_type` in release.
- H26 confirms generic hidden bad-signature entry still traps at call time.
- H28/H30 confirm hidden dispatch injection works with `WebAssembly.Function`
  entries and generic wrapper tier-up, including after donor refs are dropped
  and GC runs.
- H33 confirms a stronger same-signature integrity break: typed
  `table.get(1)+call_ref` executes the visible `WasmFuncRef`, while
  `call_indirect(1)` executes a different hidden dispatch target from the same
  table index.
- H34 confirms the visible entry can be installed through normal JS API while
  `raw_type=externref`; no direct `FixedArray` entry write needed. After raw
  type restore, `victim.get(1) === visible`, but `call_indirect(1)` executes
  the hidden donor dispatch target.

### S5 - `SharedFunctionInfo.trusted_function_data`

### S5 - `SharedFunctionInfo.trusted_function_data`

Field:

- `src/objects/shared-function-info.tq`: `trusted_function_data:
  TrustedPointer<ExposedTrustedObject>`

First consumers:

- Wasm import resolution reads exported function metadata from
  `SharedFunctionInfo`.
- `src/wasm/module-instantiate.cc` consumes `WasmFunctionData` during import
  wrapper creation.

Existing upstream test:

- `test/mjsunit/sandbox/wasm-imports-concurrent-mutation.js`
  races `trusted_function_data` between incompatible exported Wasm functions
  during instantiation.

Guard:

- Type tag range for `WasmFunctionData` plus import-time signature checks.
- Race window is between reading trusted function data and later signature /
  wrapper use.

New variants:

- Same-field mutation but not during instantiation: mutate after import wrapper
  creation, then force lazy wrapper / tier-up / deopt use.
- Cross-isolate worker mutation during tier-up rather than during initial
  import resolution.

Status:

- H32 tested post-instantiation mutation from writer TFD to dummy TFD.
- Later calls and tier-up still used the copied import/dispatch state.
- This branch likely requires the known instantiation race window or a new
  protected-data mutation primitive; post-instantiation SFI mutation is too late.

### S6 - `JSFunction.dispatch_handle`

Field:

- `JSFunction::dispatch_handle`, exposed by Sandbox testing API.

First consumers:

- JS dispatch table call entry resolution.

Existing upstream tests:

- `test/mjsunit/sandbox/regress/regress-342297062-{1,2,3}.js`
- `test/mjsunit/sandbox/regress-443772809.js`
- `test/mjsunit/sandbox/regress/regress-462217236.js`

Guard:

- JS dispatch table handle validation and target signature compatibility.

New variants:

- Cross-kind dispatch handle swaps involving Wasm wrappers / asm.js wrappers,
  not plain JS function to JS function.
- Handle lifetime: stale handle after code aging / GC / wrapper regeneration.
