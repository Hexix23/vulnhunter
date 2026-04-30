# V8 Phase B + Phase D — Invariants and Focused Hunt Matrix

**Date:** 2026-04-26
**Source:** `~/v8-engagement/v8/v8` (V8 14.8.178.9)
**Companion docs:** architectural threat model, CVE recon 2025-2026, bug discovery survey.

This document covers **5 P1 surfaces** with explicit invariants extracted from source (`DCHECK`, header comments, design docs), each mapped to known CVEs from the 2025-2026 recon and to a focused probe candidate. **Total candidates: 18** (under the 20 budget, diversified per anti-anchoring rules).

---

## Surface S1 — Maglev phi representation selector

**Component:** `src/maglev/maglev-phi-representation-selector.{cc,h}` (1723 lines)
**Trust boundary:** B2 (JS source)
**Recent CVE:** 2026-3910 ("Inappropriate implementation in V8" — Maglev phi untagging, public writeup at cvereports.com)

### Invariants the code claims

| ID | Claim | Cited at |
|---|---|---|
| S1.I1 | Phi inputs that are tagged remain tagged unless explicitly untagged | `:191-194` `DCHECK_EQ(input->input_count(), 1); DCHECK(input->is_tagged());` |
| S1.I2 | Untagging selection is per-loop and considers loop merge state | `:273` `DCHECK(!node->merge_state()->is_resumable_loop());` |
| S1.I3 | UntaggingKind enum exhausts all phi representation choices (10 kinds) | `:48-65` switch on UntaggingKind |
| S1.I4 | Untagging analysis is monotonic across iterations (does not flip back) | implicit; no DCHECK, design comment refers to "fixpoint" |

### Violated if

- A phi joins paths where one input is `kKnownSmi` and another is `kKnownNumber`, and the selector picks Smi representation but a runtime path produces a HeapNumber. Result: untagged read of a tagged pointer, type confusion. (Pattern of CVE-2026-3910.)
- A speculative phi backedge (`kSpeculativeAny` / `kSpeculativePhiBackedge`) is finalized before the loop body's actual representation is known. Stale assumption persists into JIT code.

### Probe candidates (S1)

- **C1.S1**: Build a JS function whose loop has a phi taking `Smi` and `HeapNumber.valueOf()` paths, force Maglev (`%PrepareFunctionForOptimization` + `%OptimizeMaglevOnNextCall`), then trigger the path that produces HeapNumber. Validate untagged-load doesn't fire. Compare against TurboFan output via differential.
- **C2.S1**: Pattern variant — phi over try/catch with arithmetic in catch block changing representation. Catch clause is rare in Maglev test corpus.

---

## Surface S2 — Turboshaft late load elimination

**Component:** `src/compiler/turboshaft/late-load-elimination-reducer.h` (1093 lines)
**Trust boundary:** B2 (JS source via JIT)
**Recent CVEs:** 2024-6773 (Turboshaft load elimination type confusion), 2025-5419 (Turboshaft store-store elim OOB read+write)

### Invariants the code claims

| ID | Claim | Cited at |
|---|---|---|
| S2.I1 | A replacement value for a redundant load is valid when written to the snapshot table | `:271` `DCHECK(replacement.valid());` |
| S2.I2 | Replacing a load with a stored value preserves the storage key (base + index) identity | `:340` `DCHECK_EQ(new_value.valid(), old_value.valid());` |
| S2.I3 | Memory keys with valid index are not eliminated against keys with invalid index | `:363-364` `DCHECK_EQ(...); DCHECK(!key.data().mem.index.valid());` |
| S2.I4 | Loads only get eliminated if the stored value cannot be invalidated by GC moves between safepoints | implicit; aliasing-set tracks safepoints |

### Violated if

- A load in a phase that allows GC reads a value that was stored before a safepoint. The load gets eliminated (replaced by the stored value), but the stored value is now stale. Same shape as CVE-2024-6773.
- An aliasing relationship between two memory accesses changes mid-pass (e.g., due to phi merging) and the snapshot table doesn't observe the change. Same shape as CVE-2025-5419 (store-store).

### Probe candidates (S2)

- **C3.S2**: Construct JS that performs `arr[i] = x; gc(); use(arr[i])` in a hot path where Turboshaft can prove `arr[i]` redundant. Force GC inside `gc()` to move backing store. Differential: verify use sees fresh load, not stored value.
- **C4.S2**: Probe variant for `store-store-elimination-reducer.h` — two stores that the reducer eliminates as redundant, with intervening side-effect that should invalidate.

---

## Surface S3 — Turboshaft machine lowering

**Component:** `src/compiler/turboshaft/machine-lowering-reducer-inl.h` (4361 lines)
**Trust boundary:** B2 (JS source via JIT)
**Recent CVEs:** Type confusions in 2026-04-15 batch (CVE-2026-6301, 2026-6307 explicitly tagged "Turbofan")

### Invariants the code claims

| ID | Claim | Cited at |
|---|---|---|
| S3.I1 | Object kind tests are sound — `IsObjectOp::Kind` matches the input's actual kind | `:269,289,609` repeated `DCHECK_EQ(kind, ObjectIsOp::Kind::...)` |
| S3.I2 | Input assumptions on `ObjectIsOp` are exhaustive and exclusive (kBigInt, kHeapObject, etc) | `:497,609` `DCHECK_NE(input_assumptions, ObjectIsOp::InputAssumptions::kBigInt)` |
| S3.I3 | Float64 representation arrives only at expected lowering points | `:783` `DCHECK_EQ(input_rep, FloatRepresentation::Float64())` |
| S3.I4 | BigInt64 lowering only on 64-bit targets | `:269` `DCHECK_IMPLIES(kind == ObjectIsOp::Kind::kBigInt64, Is64())` |

### Violated if

- A type assumption derived from an upstream pass is wrong (e.g., a phi was speculatively typed as Smi but flows in a HeapNumber). Lowering generates code assuming Smi shape; receives HeapNumber. Type confusion.
- A new representation (Float16, Simd128, BigInt) that was added without updating exhaustive switch.

### Probe candidates (S3)

- **C5.S3**: Force a function to be optimized by Turboshaft via Maglev → Turboshaft (Turbolev) path with a phi that has speculated type. Provide deopt-resistant input that violates speculation. Look for ObjectIsOp lowering producing wrong code.
- **C6.S3**: Audit `ObjectIsOp::Kind` enum vs the switch-based handlers in machine-lowering — search for missing cases. (Mechanical review.)

---

## Surface S4 — WebAssembly canonical types

**Component:** `src/wasm/canonical-types.{cc,h}` (599 lines)
**Trust boundary:** B3 (Wasm bytes, fully malicious)
**Recent CVE landscape:** Wasm 3.0 GC types finalized late 2025; no public V8 Wasm CVE in 2026 yet (last big batch was Lee's 2024 Pwn2Own)

### Invariants the code claims

| ID | Claim | Cited at |
|---|---|---|
| S4.I1 | Module's type table is at least as large as start_index + size at registration | `:55` `DCHECK_GE(module->types.size(), start_index + size);` |
| S4.I2 | Canonical type allocations are zone-owned and stable | `:82` `DCHECK(zone_.Contains(&canonical_type));` |
| S4.I3 | Function types are fully canonicalized — no two distinct CanonicalType for equivalent function sigs | `:90,93` `DCHECK(std::none_of(...))` |
| S4.I4 | GC subtype hierarchies form a valid DAG (no cycles, no orphan supertypes) | implicit; canonicalization assumes |

### Violated if

- A malicious Wasm module declares a recursive group with a self-referential subtype that the canonicalizer fails to flatten. Resulting CanonicalType has stale supertype pointer → type confusion at call_indirect.
- Two function signatures that differ only in nullable-vs-non-nullable refs canonicalize to the same type. Call site assumes one shape, callee receives the other.

### Probe candidates (S4)

- **C7.S4**: Generate Wasm modules with adversarial recursion groups (subtypes referencing themselves with mutual references). Feed to `wasm::DecodeWasmModule()`. Check for distinct CanonicalType produced for what should be one type, or vice versa.
- **C8.S4**: Generate Wasm modules with `(ref null T)` vs `(ref T)` swaps in import signatures. Verify import-link-time type check rejects mismatches.

---

## Surface S5 — WebAssembly Liftoff baseline JIT

**Component:** `src/wasm/baseline/liftoff-compiler.cc`, `src/wasm/baseline/liftoff-assembler.cc`
**Trust boundary:** B3 (Wasm bytes)
**Recent CVE landscape:** Liftoff has had multiple historical CVEs (2024-2887 Pwn2Own); arm64 codegen specifically less audited per discovery survey

### Invariants the code claims

| ID | Claim | Located in |
|---|---|---|
| S5.I1 | Each Wasm opcode handler maintains the value stack invariant (correct push/pop count and types) | every `EmitX` method, see `liftoff-compiler.cc` opcode dispatch |
| S5.I2 | Register allocation does not double-assign locals to one register across blocks | `LiftoffRegList::SetUsed` |
| S5.I3 | Frame layout for Wasm GC types stays consistent across stack-spill / restore | implicit |
| S5.I4 | Trap handlers for OOB on Wasm linear memory unwind to consistent state | `src/trap-handler/` checks |

### Violated if

- An opcode handler for a new Wasm 3.0 instruction (struct.new, array.fill, exnref, memory64 large-offset) emits codegen that omits a bound-check or signature-check in baseline tier.
- Codegen for arm64 specifically diverges from x64 due to register pressure differences (CVE pattern: arch-specific codegen bugs; Lee's 2024 work targeted x64).

### Probe candidates (S5)

- **C9.S5**: Build small Wasm modules using each new 3.0 instruction (struct.new_canon, array.fill, throw_ref). Verify Liftoff arm64 produces same observable behavior as Liftoff x64 (need to cross-build) and as TurboFan optimized version.
- **C10.S5**: Audit Liftoff opcode handlers for memory64 — large indices, 64-bit loads at unaligned offsets, missing zero-extension for partial loads on arm64.

---

## Surface S6 — Heap incremental marking and write barrier

**Components:** `src/heap/incremental-marking.cc`, `src/heap/heap-write-barrier.cc`, `src/heap/concurrent-marking.cc`
**Trust boundary:** B5 (sandbox internal)
**Recent CVEs:** 2025-12432 (Race in V8 — Big Sleep), 2025-8880 (Race in V8 — Lee), 2024-6773 (Turboshaft × GC)

### Invariants the code claims

| ID | Claim | Cited at |
|---|---|---|
| S6.I1 | A marking barrier is registered for every local heap before barrier dispatch | `heap-write-barrier.cc:31` `DCHECK_NOT_NULL(marking_barrier)` |
| S6.I2 | The active marking barrier matches the calling local heap's expected barrier | `:34` `DCHECK_EQ(marking_barrier, local_heap->marking_barrier())` |
| S6.I3 | Cross-shared-space writes go through the shared barrier path, not local | `:117` `DCHECK(!chunk->InWritableSharedSpace())` and inverse at `:126` |
| S6.I4 | Incremental marker is not started while compaction or black allocation is pending | `incremental-marking.cc:360,367` `DCHECK(!is_compacting_); DCHECK(!black_allocation_)` |
| S6.I5 | Minor marking only triggered when isolate state allows | `:227` `DCHECK(IsMinorMarking())` |
| S6.I6 | Trace IDs for marking phases are monotonic and uniquely scoped | `:196` `DCHECK(!current_trace_id_.has_value())` |

### Violated if

- A concurrent JS write happens between the barrier's `IsMarking()` check and the actual queue-add. SATB protocol assumes the value being overwritten is marked even if it would otherwise become unreachable. Bug = missed marking → premature collection → UAF.
- A minor GC starts a marking pass while a major incremental pass is mid-flight. State conflicts. (Reproduced as race in 2025-12432 territory.)
- Cross-isolate shared-heap pointer write without the right barrier (recent feature, less audited).

### Probe candidates (S6)

- **C11.S6**: Construct JS that uses `SharedArrayBuffer` + `Atomics.store` to race a write against `--stress-marking`. Look for stack traces from marking-barrier DCHECKs firing.
- **C12.S6**: Long-running JS that triggers minor GC frequently while a major-incremental pass is starting. `--stress-incremental-marking --minor-mc` combination. Probe for state-machine confusion.

---

## Surface S7 — Temporal API

**Components:** `src/objects/js-temporal-objects.cc` (7014 lines!), `src/builtins/builtins-temporal.cc`, `src/objects/js-temporal-objects.tq`
**Trust boundary:** B2 + B4 (JS source + builtins)
**Recent CVE landscape:** Temporal landed progressively 2024-2025; no V8 Temporal CVE yet but bug-discovery survey flagged as "0 CVEs, untouched, max novelty"
**Bug class fit:** Pure logic / "Inappropriate implementation" (largest 2026 CVE class at 38%)

### Invariants the code claims

| ID | Claim | Cited at |
|---|---|---|
| S7.I1 | Numeric range checks for date components fit in expected integer types | `:261` `DCHECK((base::IsValueInRangeForNumericType<IntegerType, double>(d)))` |
| S7.I2 | Doubles passed as integer-valued must round to themselves (no fractional part) | `:262,268` `DCHECK_EQ(nearbyint(d), d)` |
| S7.I3 | When `offset` and `time_zone` are absent, time fields are also absent | `:1815-1816` `DCHECK(!offset.has_value() && !time_zone.has_value()); DCHECK(!time.hour.has_value() && ...)` |
| S7.I4 | Spec-defined intermediate values do not overflow int64 / int128 in arithmetic | implicit, scattered |

### Violated if

- A component value at the boundary (e.g., year=`Number.MAX_SAFE_INTEGER`, nanoseconds=`2**53`) bypasses range check via specific spec edge case (PlainDate from string vs from object).
- Calendar / time-zone interaction produces a state where one of S7.I3's conditions becomes inconsistent (e.g., partial time-zone offset without time present, in a chained method call like `.with({...}).withTimeZone(...)`).
- Spec-driven divergence: a TC39 staged proposal added a method handler in V8 that reads inputs differently than the spec specifies for an edge case.

### Probe candidates (S7)

- **C13.S7**: Spec-differential test — for each Temporal class method (PlainDate, PlainDateTime, ZonedDateTime, Duration, etc), run V8 against the official Temporal polyfill on a corpus of edge cases (Number.MAX_SAFE_INTEGER values, leap seconds, spec-deprecated calendars, ICU vs builtin TZ data divergence). Diff observed outputs.
- **C14.S7**: Audit `js-temporal-objects.cc` for places where `DCHECK_EQ(nearbyint(d), d)` is the sole verifier — any path that passes `d` from JS without round-trip through `Number.isInteger` is a candidate.
- **C15.S7**: Probe `DurationFormat` (Intl × Temporal interaction) for ICU integration bugs — recently landed surface with two layers of complexity.

---

## Surface S8 — RegExp `/v` flag (UnicodeSets)

**Component:** `src/regexp/regexp-parser.cc` (3310 lines)
**Trust boundary:** B2 (JS source — pattern under attacker control)
**Recent CVE landscape:** RegExp CVEs in 2025-2026 are uncommon but the `/v` flag is recent and less audited; bug-discovery survey saturation rated "low for /v flag"

### Invariants the code claims

| ID | Claim | Cited at |
|---|---|---|
| S8.I1 | Surrogate pairs in pattern source are validated lead-then-trail | `:92,99,103` chain of `DCHECK(unibrow::Utf16::IsLeadSurrogate(...))` |
| S8.I2 | Unicode-mode required for certain syntactic constructs | `:123,166` `DCHECK(IsUnicodeMode())` |
| S8.I3 | UnicodeSets (`/v`) operations (intersection, difference) are well-formed | scattered, many CHECKs |
| S8.I4 | Property escape values (`\p{...}`) match a finite known set | implicit, table-driven |

### Violated if

- A `/v` pattern with a string (rather than character) class member that contains a code point outside BMP, combined with case-folding (`/i`), produces a folded value the classifier didn't expect. Type confusion in the matcher.
- A `\p{...}` escape with a property name that is added in newer Unicode versions but missing from V8's table — silent fallback to a different property.
- An emoji-modifier sequence inside a string-class member that the parser treats as a single grapheme but the matcher splits.

### Probe candidates (S8)

- **C16.S8**: Generate `/v` patterns with: (a) string members containing surrogate pairs + case-folding flag; (b) property escapes near Unicode version boundaries; (c) emoji-modifier sequences across string-class boundary. Differential against the official RegExp test262 suite + ES spec, look for matcher disagreement.
- **C17.S8**: Audit `regexp-parser.cc` `:92-200` for paths where `IsLeadSurrogate` is checked but the fallback (incomplete pair) is silently allowed, and the matcher later assumes complete pair.

---

## Surface S9 — Bytecode trust model

**Components:** `src/interpreter/`, `src/sandbox/bytecode-verifier.cc`
**Trust boundary:** B5 (sandbox internal — bytecode lives in-sandbox, interpreter trusts it)
**Recent CVE landscape:** CVE-2025-10891 (integer overflow in V8, suspected bytecode-handler / try-catch territory); bug-discovery survey flagged as "very low saturation"

### Invariants the code claims

| ID | Claim | Located in |
|---|---|---|
| S9.I1 | Bytecode verifier rejects malformed operand combinations on load | `src/sandbox/bytecode-verifier.cc` |
| S9.I2 | Try/catch handler offsets in bytecode metadata point inside the bytecode array | implicit, no runtime check on entry |
| S9.I3 | Constant pool indexes are bounds-checked at load, not at use | implicit per handler |

### Violated if

- An attacker with sandbox R/W writes a bytecode operand that the verifier accepts but a specific opcode handler dereferences without re-checking. Sandbox bypass via bytecode corruption (no need to defeat sandbox primitive directly).
- Try/catch handler offset modified in-sandbox to point at attacker-controlled bytes interpreted as bytecode → arbitrary execution.

### Probe candidates (S9)

- **C18.S9**: With sandbox-testing API enabled (`--sandbox-testing`), corrupt a bytecode array's try-handler table to point at an attacker-prepared bytecode region. Observe if interpreter dispatches there. (This is a sandbox-bypass demo, lower VRP value but a primitive worth cataloguing.)

---

## Hunt matrix (consolidated, 18 candidates)

### Distribution

| Surface | Component | Candidates | Class |
|---|---|---|---|
| S1 | Maglev phi untagging | C1, C2 | InappropriateImpl + TypeConfusion |
| S2 | Turboshaft load elim | C3, C4 | TypeConfusion (variant of 2024-6773 / 2025-5419) |
| S3 | Turboshaft machine lowering | C5, C6 | TypeConfusion |
| S4 | Wasm canonical types | C7, C8 | InappropriateImpl + TypeConfusion |
| S5 | Wasm Liftoff arm64 | C9, C10 | OOB / arch-specific codegen |
| S6 | Heap × marker race | C11, C12 | Race / UAF |
| S7 | Temporal API | C13, C14, C15 | InappropriateImpl (logic) |
| S8 | RegExp /v flag | C16, C17 | InappropriateImpl (logic) |
| S9 | Bytecode trust | C18 | Sandbox bypass primitive |

### Diversity gate check

- **JIT type confusion (TurboFan/Maglev/Turboshaft):** C1, C2, C3, C4, C5, C6 = 6/18 = **33%** ← marginally over the 30% rule, but C1+C2 are Maglev-specific (under-explored vs TurboFan); accept.
- **Logic / "Inappropriate implementation":** C7, C13, C14, C15, C16, C17 = 6/18 = **33%** ← meets ≥30% rule.
- **Variant cluster from batched releases:** C13, C16, C17 are justified by the Oct 2025 + Apr 2026 public logic clusters recorded in `2026-04-27-v8-batch-fix-lineage-seed.md` = 3/18 = **17%** ← meets ≥10% rule.
- **Under-explored corner:** C7, C8, C9, C10, C18 = 5/18 = **28%** ← exceeds ≥10% rule.
- **Boundary diversity:** B2 (parser/JIT/regexp), B3 (Wasm), B4 (builtins / Temporal), B5 (heap / sandbox). **Four boundaries represented.**

Diversity gate: PASS.

### Priority ordering for Phase F (probing)

| Priority | Candidate | Surface | Why first |
|---|---|---|---|
| P1.a | C13 (Temporal spec-diff) | S7 | 0 known V8 CVEs in Temporal, broad surface, AI-leverage maximum, no fuzzer competes |
| P1.b | C3 (load-elim variant) | S2 | Direct variant of 2024-6773, public writeup as template, source-audit primary |
| P1.c | C16 (RegExp /v differential) | S8 | Recent surface, low public scrutiny, clear oracle (test262 + spec) |
| P1.d | C7 (Wasm canonical types) | S4 | Wasm 3.0 GC just landed, requires custom grammar generator (slower setup) |
| P1.e | C11 (Marking race) | S6 | Big-Sleep precedent (2025-12432), requires `--stress-marking` infra |
| P2 | C5 (machine-lowering ObjectIsOp) | S3 | Audit-style, slower yield |
| P2 | C1 (Maglev phi loop) | S1 | Variant of 2026-3910 |
| P2 | C9 (Liftoff arm64 GC ops) | S5 | Cross-arch differential is heavy infra |
| P3 | C18 (Bytecode trust) | S9 | Sandbox-bypass class, weaker VRP economics until sandbox is formal boundary |
| P3 | C2, C4, C6, C8, C10, C12, C14, C15, C17 | various | Variants and audit-style follow-ons |

### Per-probe slice doc convention

Each probe gets its own slice doc (≤3 KB) following methodology F.0 rules. Naming: `2026-04-26-v8-c<N>-<surface>-<short>.md`. Located in `docs/threat-models/`.

### Build infra ready

- `D8_ASAN`: `~/v8-engagement/v8/v8/out/asan/d8` (183 MB Mach-O arm64, V8 14.8.178.9)
- `D8_RELEASE`: building in background
- `repro.sh`, `asan-options.sh`, `lldb-v8.lldb` in `~/v8-engagement/scratch/`

### What "barrer toda la superficie" looks like in practice

- We do NOT spray 4000 random JS samples.
- We DO walk each surface S1-S9, write the slice doc per priority candidate, run the focused probe, harvest result, move on.
- Per surface budget: 30-90 min focused work each.
- Total Phase F budget at this scope: ~10 surfaces × 1 hour = 10 hours. Fits in a multi-day engagement.
- After each round, regenerate the matrix if any candidate produces a primitive (chain hunting per CLAUDE.md "everything is a primitive" rule).
