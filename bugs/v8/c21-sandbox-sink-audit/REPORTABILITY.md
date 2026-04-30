# C21 Reportability / VRP Triage

Scope note:

- Chrome VRP wants actionable security bugs with minimized PoC, repro steps,
  version/channel, and evidence. A sandbox escape is not required for every
  report; the bar is demonstrable security consequence and reproducibility.
- V8 sandbox bugs are in Chrome VRP scope, but bugs specific only to
  `--experimental` V8 configurations are not reward-eligible.
- C21 PoCs currently rely on the sandbox memory-corruption testing API to model
  an attacker who can corrupt in-sandbox fields. That is valid for sandbox
  hardening research, but not automatically a user-triggerable Chrome bug.

References:

- Chrome VRP FAQ:
  `https://chromium.googlesource.com/chromium/src/+/main/docs/security/vrp-faq.md`
- V8 sandbox VRP inclusion:
  `https://v8.dev/blog/sandbox`

Checked: 2026-04-28.

Key VRP constraints from current docs:

- Report must show reachability/exploitability by web content or compromised
  renderer, plus user harm/security consequence.
- Static/theoretical bugs without demonstrated security issue are weak and may
  be closed as unactionable.
- `--experimental`-specific V8 bugs are not Chrome VRP reward-eligible.
- V8 sandbox testing API is an accepted way to emulate an attacker with
  arbitrary in-sandbox corruption, but report still needs a sandbox invariant
  violation or security consequence.

## Current triage summary

Impact model:

- Do not measure C21 only as "sandbox escape or nothing".
- Current best class is `WRONG_CODE / EXECUTION_INTEGRITY` under
  `SANDBOX_INVARIANT`.
- H27, H33, and H34 are security-relevant primitives even before escape:
  they prove wrong target/body execution from trusted-state divergence.
- Final VRP threshold still needs normal reachability or stronger sandbox
  boundary consequence, but the branch remains alive.

### Not enough for VRP as-is

These are useful primitives, but not standalone VRP-grade findings yet because
they require the testing memory-corruption API and do not show an independent
renderer/WebAssembly trigger or sandbox escape.

- H5-H11: forged `externref` from numeric `i64` global bytes.
  - Impact: fake object reference / stale relocation crash under sandbox
    corruption model.
  - Missing: reachable corruption source without testing API, or stable security
    impact beyond in-sandbox crash/stale ref.
- H12: TypedArray sandboxed-pointer redirect.
  - Impact: clean in-sandbox RW over backing stores.
  - Missing: out-of-sandbox pointer or trusted-table corruption.
- H13-H16: ArrayBuffer extension handle alias/crash.
  - Impact: transient backing-store alias and invalid-handle crash.
  - Missing: persistent UAF, escape, or externally triggerable exploit path.
- H21: dispatch-table shorter-handle OOB attempt.
  - Impact: reaches dangerous shape.
  - Guard: release `SBXCHECK_BOUNDS` safely terminates before OOB write.

### Candidate security bugs / worth deeper analysis

These violate trusted-state invariants and may be worth reporting if we can
package them as V8 sandbox invariant bugs, but they are stronger if chained to
confidentiality/integrity impact.

#### H23/H24 - hidden dispatch injection

Observed:

- JS-visible victim table entries are attacker marker objects.
- Fresh Wasm importer calls hidden donor dispatch entry at the same index.
- Donor target remains rooted after GC.

Impact:

- Trusted dispatch state diverges from JS-visible table state.
- Callable trusted state can be injected into another table through:
  1. `trusted_dispatch_table` handle transplant,
  2. `raw_type` corruption to `externref`,
  3. `grow()` copying stale dispatch entries,
  4. raw type restore and fresh import.

Why potentially reportable:

- This crosses from sandbox-corruptible metadata to trusted dispatch behavior.
- It is not just a crash.

Why not final VRP yet:

- Still requires testing memory-corruption API.
- Signature checks and table-type checks stop obvious type-confusion escalation.
- No out-of-sandbox or user-data impact yet.

Next escalation target:

- Mutate/corrupt dispatch `sig` or `WasmImportData.sig` so hidden dispatch
  entry is callable under a mismatched signature.
- Find a natural V8 bug that corrupts `trusted_dispatch_table` or `raw_type`
  without testing API.

#### H27 - `WasmFuncRef.trusted_internal` signature-confused execution

Observed:

- `func0(i32)->i32` executes through a `func1(i64)->i32` `call_ref`.
- The wrong function writes `0x41414141` to Wasm memory.

Impact:

- Concrete wrong-body execution, not passive crash.
- Bounded by Wasm memory checks in current PoC.

Why potentially reportable:

- Violates type/signature invariants around `WasmFuncRef.trusted_internal`.
- Demonstrates attacker-influenced control/data confusion.

Why not final VRP yet:

- Requires testing memory-corruption API.
- Wrong-body effects are in-bounds Wasm memory only.
- Optimized inlining path is guarded by release
  `InlineTargetIsTypeCompatible(...)`.

Next escalation target:

- Use imported-wrapper / `WasmImportData` path so wrong body interprets
  `implicit_arg` or signature metadata rather than ordinary Wasm linear memory.
- Combine with H23 hidden dispatch so wrong function is installed behind a table
  entry whose JS state cannot explain it.

#### H33 - visible table entry vs hidden dispatch target divergence

Observed:

- Typed `table.get(1)` returns a valid visible `WasmFuncRef`.
- `call_ref(table.get(1), 5)` executes the visible function and returns `117`.
- `call_indirect(1, 5)` on the same imported table/index executes a different
  hidden dispatch target and returns `37`.

Impact:

- Same-index Wasm table execution divergence.
- Integrity violation between `WasmTableObject.entries` and trusted
  `WasmDispatchTable`.
- Stronger than marker/null desync because both functions have compatible
  signatures and both calls are successful.

Why potentially reportable:

- Demonstrates incorrect trusted execution state, not just DoS.
- Maps directly to V8 sandbox attack surface: corruptible in-sandbox table
  metadata affects trusted dispatch behavior.

Why not final VRP yet:

- Still requires sandbox memory-corruption testing API.
- Does not require `--experimental-wasm-type-reflection`; H33 reproduces
  without that flag.
- No normal JS/Wasm input source for the corruption yet.
- No out-of-sandbox read/write or trusted OOB yet.

Next escalation target:

- Find normal-input source for `raw_type` / `trusted_dispatch_table`
  corruption, or combine H33 with signature/implicit-arg mutation for memory
  safety impact beyond same-signature wrong-code execution.

#### H34 - same divergence with normal JS API entry write

Observed:

- After field corruption, `victim.grow(2, null)` and
  `victim.set(1, visible)` are ordinary JS API calls.
- `victim.get(1) === visible`.
- `visible(5)` returns `117`.
- `call_indirect(1, 5)` returns `37`.

Impact:

- Cleanest C21 artifact so far: JS-visible table state is installed by V8's
  public Table API, but trusted dispatch still executes another target.
- Does not need direct `FixedArray` element write.
- Reproduces without `--experimental-wasm-type-reflection`.

Why potentially reportable:

- Current dcheck-only invariant at `src/wasm/wasm-objects.cc:291`
  (`old_size == dispatch_table->length()`) is security-relevant under the V8
  sandbox attacker model.
- A corrupted trusted-pointer handle to a valid same-typed dispatch table can
  make release V8 trust mismatched dispatch length/state and produce incorrect
  execution.

Why not final VRP yet:

- Still requires memory-corruption API for `trusted_dispatch_table` and
  `raw_type`.
- No out-of-sandbox read/write yet.

Next escalation target:

- Prepare as sandbox hardening candidate while continuing to search for:
  normal corruption source, trusted table OOB, or wrong implicit-arg/signature
  impact.

### Refuted / lower priority

- H25: typed-table import of generic hidden dispatch dies at release
  `dispatch_table->table_type()` check.
- H26: generic hidden bad-signature entry traps with
  `RuntimeError:function signature mismatch`.
- H28/H30: hidden JS wrapper dispatch and wrapper tier-up remain coherent,
  even after dropping donor refs and forcing GC.
- H29: optimized/inlined `trusted_internal` confusion dies at release
  `InlineTargetIsTypeCompatible(...)`.
- H31: `Table.set` after func-ref internal transplant still traps at call time.
- H32: post-instantiation `SharedFunctionInfo.trusted_function_data` mutation is
  too late; dispatch/import state already copied.

## Reporting threshold

Do not submit C21 as a final VRP report unless one of these is true:

1. A PoC triggers the bug without `--sandbox-testing` /
   `--expose-memory-corruption-api` by using normal JS/Wasm inputs.
2. A sandbox-corruption PoC demonstrates out-of-sandbox read/write, trusted
   table OOB, code pointer/signature corruption, or renderer process integrity
   impact.
3. A spec/logic issue is reachable by normal web content and causes security
   impact beyond DoS.
4. Chrome/V8 security explicitly accepts the invariant violation as a sandbox
   hardening bug; then report as `Security_Impact-None` or equivalent hardening
   issue, not as full exploit.

Do submit or prepare for submission if we get any normal-input PoC with:

- Type confusion, UAF, OOB read/write, stale trusted pointer use, or controlled
  crash with memory-safety root cause.
- Incorrect Wasm/JS execution that violates type isolation and changes attacker
  observable behavior.
- Spec/logic bug with integrity, confidentiality, UX security, origin/security
  boundary, or renderer impact.
- Sandbox invariant violation under memory-corruption API that reaches trusted
  memory, code pointers, dispatch table OOB, or out-of-sandbox read/write.

## Next work queue

Priority order:

1. H35: derive `WasmImportData.sig` / `bit_field` mutation path through wrapper
   objects and test wrong wrapper signature.
2. H36: combine H34 visible/hidden divergence with H27 wrong-body execution in
   a single fresh importer path.
3. H37: search for non-testing-API corruption sources that can affect
   `WasmTableObject.raw_type`, `trusted_dispatch_table`, or
   `WasmFuncRef.trusted_internal`.
4. H38: report-quality minimization: remove unnecessary flags from any surviving
   PoC and run in `out/sandbox_release_linux/d8` without debug-only flags.
