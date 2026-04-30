# V8 Engine — Architectural Threat Model

**Date:** 2026-04-26
**Target:** V8 14.8.178.9 (Chrome 148 stable), source at `~/v8-engagement/v8/v8`
**Purpose:** Phase A architectural threat model (boundaries + subsystems + trust assumptions). Companion to the CVE recon (`2026-04-26-v8-cve-recon-2025-2026.md`) and the bug-discovery survey (`2026-04-26-v8-bug-discovery-survey.md`).
**Daily-use note:** use `2026-04-27-v8-minimal-threat-model.md` as the primary working set. This document is reference material and should not be pasted wholesale into probe prompts.
**Source basis:** `src/` walked top-level (49 subdirectories, 3046 C++ files, 244 Torque files), plus `include/APIDesign.md`, `src/sandbox/README.md`, `docs/security/triaging.md`.

---

## 1. What V8 is, in one paragraph

V8 is an in-process JavaScript and WebAssembly execution engine that compiles and runs JS/Wasm code on behalf of an embedder. It exposes a C++ API (`include/v8-*.h`) for embedders (Chrome renderer, Node.js, Deno, Electron, Cloudflare Workers, custom) to create Isolates, install global objects, run scripts, and exchange values. Inside an Isolate, V8 parses source, generates bytecode, executes it through the Ignition interpreter, optionally tiers up via Sparkplug → Maglev → TurboFan/Turboshaft, and manages object lifetimes through Orinoco GC. V8 also implements WebAssembly through Liftoff (baseline) and Turboshaft (optimizing) compilers. Recent versions add an optional in-process sandbox that confines V8 heap memory to a contiguous virtual address range, treating in-sandbox memory as untrusted even from within the V8 process.

## 2. Trust boundaries (the core of the model)

V8's threat model has five trust boundaries, in increasing order of attacker control.

### B1 — Embedder ↔ V8 (configuration boundary)

The embedder calls `v8::Initialize`, `v8::Isolate::New`, registers `v8::Platform`, `v8::ArrayBuffer::Allocator`, snapshot blobs, command-line flags. Embedder is **trusted** by V8 — V8 explicitly assumes the embedder is benign.

**Attacker model:** none from V8's perspective. The embedder's own threat model determines whether embedder-side bugs (Chrome flag handling, Node ESM loader) can corrupt this boundary indirectly.

**Where this lives:** `src/api/`, `include/v8-*.h`, `src/init/`.

### B2 — V8 ↔ JS source code (script boundary)

The embedder calls `v8::Script::Compile` / `v8::Script::Run` with attacker-controlled source bytes. This is the canonical web threat model: any JS executes that the renderer was asked to execute.

**Attacker model:** **fully malicious JS source**. V8 must produce correct results or controlled errors for any input string. Any memory-safety bug, type-confusion, or sandbox violation triggered by JS source is a vulnerability.

**Where this lives:** `src/parsing/` (scanner + parser), `src/ast/` (AST), `src/interpreter/` (bytecode generator), `src/codegen/` (bytecode → machine code lowering).

### B3 — V8 ↔ Wasm bytes (Wasm module boundary)

The embedder hands raw Wasm bytes to V8. V8 decodes, validates, compiles (Liftoff baseline → Turboshaft optimizing), and instantiates.

**Attacker model:** **fully malicious Wasm bytes**, possibly with attacker-controlled imports / exports / type sections / GC subtypes.

**Where this lives:** `src/wasm/` (decoder, validator, baseline, turboshaft, runtime).

### B4 — JS ↔ V8 internal builtins (intrinsic boundary)

JS calls built-in functions written in C++ (`src/builtins/`) or Torque (`src/builtins/*.tq`) or CSA (CodeStubAssembler). These are V8-authored fast paths for `Array.prototype.sort`, `String.prototype.replace`, etc. JS attacker provides receiver and arguments.

**Attacker model:** **JS-controlled receiver and args**, including pathological values (undefined, null, frozen, proxy, detached typed arrays, very large indexes).

**Where this lives:** `src/builtins/` (280 files), `src/torque/` (compiler), `src/runtime/` (slow-path handlers).

### B5 — In-sandbox memory ↔ Out-of-sandbox memory (sandbox boundary)

This is the **newest and most consequential boundary** (active project since 2022). Inside V8's sandbox memory region, all bytes are **assumed attacker-controlled** even from V8's own perspective. V8 must not trust any pointer, length, or tag read from in-sandbox memory.

The sandbox replaces raw pointers with one of: indices into pointer tables (External Pointer Table, Code Pointer Table, Trusted Pointer Table, JS Dispatch Table), bounded sizes, sandboxed-pointer offsets relative to the sandbox base. Code execution must use only validated entry points.

**Attacker model:** **arbitrary R/W within the sandbox region**. Anything escaping to out-of-sandbox memory (process-wide RAM) is a sandbox violation. This is now the primary security boundary V8 enforces internally.

**Where this lives:** `src/sandbox/` (53 files), and every place in V8 that crosses the boundary — typed array backing stores, JIT-emitted code that materializes raw pointers, GC scanning of root sets, snapshot deserialization.

**Note:** the V8 sandbox is **not yet a formal security boundary** in upstream Google policy as of mid-2026 (per `src/sandbox/README.md`). Bypasses are tracked but do not yet receive baseline severity in Chrome VRP. This may change. Roughly 90+ public bypasses are documented.

## 3. Major subsystems and their internal boundaries

Each subsystem has its own input-validation contract and historical bug pattern. Mapped to `src/` directories.

| Subsystem | `src/` dir | Files | Trust boundary | Common bug class |
|---|---|---|---|---|
| Public C++ API | `api/` | 8 | B1 | Misuse-resistance only |
| Parser / Scanner | `parsing/` + `ast/` | 32 + ast | B2 | Scope confusion, lazy-parse mismatch |
| Bytecode generator | `interpreter/` | 52 | B2 | Bytecode operand corruption |
| Sparkplug (baseline JIT) | `baseline/` | — | B2 | Less audited, smaller surface |
| Maglev (mid JIT) | `maglev/` | 86 | B2 | Phi untagging, IC mishandling, incomplete init |
| TurboFan / Turboshaft (optimizing JIT) | `compiler/` | 497 | B2 | Type confusion, escape analysis, store-store elim, bounds elim |
| Code generation backend | `codegen/` | 246 | B2 | Codegen miscompilation per arch |
| Runtime helpers | `runtime/` | 35 | B4 | Receiver-type confusion |
| Inline caches | `ic/` | 21 | B4 | IC state machine confusion |
| Builtins (Torque + CSA) | `builtins/` | 280 | B4 | Missing bounds checks, fast/slow-path divergence |
| Objects layout | `objects/` | 438 | B5 | Type-tag confusion, hidden class transitions |
| Heap / GC (Orinoco) | `heap/` | 326 | B5 | Concurrent marking races, write-barrier misses, ephemeron UAF |
| RegExp (Irregexp + non-backtracking) | `regexp/` | 79 | B2 | Backtracking complexity, /v flag, Unicode property escapes |
| WebAssembly | `wasm/` | 163 | B3 | Decoder, GC types, Liftoff codegen, signature mismatches |
| Inspector / DevTools | `inspector/` | — | B1+B2 mixed | Mostly logic / UX |
| Snapshot serialization | `snapshot/` | — | B1 | Deserialization inconsistency, hash flooding |
| Sandbox enforcement | `sandbox/` | 53 | B5 | TPT corruption, raw-pointer escape, pointer-table tag mishandling |
| Trap handler | `trap-handler/` | — | B5 | Wasm OOB → signal handler |
| Torque language compiler | `torque/` | — | meta | Generated code inherits Torque-author bugs |
| Date / numbers / strings / bigint / json | `date/`, `numbers/`, `strings/`, `bigint/`, `json/` | mixed | B2/B4 | Numeric edge cases, parsing bugs |
| Profiler / debug / tracing / inspector | `profiler/`, `debug/`, `tracing/` | — | B1+B2 | Side-channel info leak |
| Fuzzilli harness | `fuzzilli/` | — | meta | Test-only, in-tree fuzz integration |

## 4. Compile pipeline (the most-attacked surface)

V8 has four execution tiers, plus a fifth in development:

```
JS source ──► Parser ──► AST ──► Bytecode (Ignition interpreter)
                                       │
                                       ├──► Sparkplug (baseline JIT, copy-paste from bytecode)
                                       │
                                       ├──► Maglev (mid-tier, fast SSA-like IR)
                                       │
                                       ├──► TurboFan (legacy "Sea of Nodes" IR, being replaced)
                                       │
                                       └──► Turboshaft (modern IR, target replacement for TurboFan;
                                                        also used by Maglev → Turbolev path)
```

**Inputs to each tier:** previous tier's output (trust gradient — bytecode is "trusted" in the sense that bytecode handlers don't re-validate, but if attacker can corrupt bytecode in memory, sandbox boundary B5 applies). Feedback vectors (IC state) flow from interpreter to JIT and bias optimization.

**Phases inside Turboshaft (where most CVE-class bugs live):**
- Reducers: `branch-elimination`, `checkpoint-elimination`, `constant-folding`, `dead-code-elimination`, `escape-analysis`, `late-load-elimination`, `loop-peeling`, `redundancy-elimination`, `representation-changes`, `store-store-elimination`, `typed-optimization`, ...
- Each reducer rewrites the IR. Bugs are typically: rewriting under wrong type assumption, dropping a side-effecting node, materializing a stale pointer across a GC safepoint, or merging two paths that should diverge.

**Phases inside Maglev (newer, less audited):**
- Phi untagging (CVE-2026-3910 — explicit), object allocation, escape analysis, IC integration. 86 files in `src/maglev/`.

**Bug yields from this compile pipeline (per CVE recon):**
- TurboFan / Turboshaft type confusion: 23 V8 CVEs in 16 months = ~34% of all V8 CVEs.
- Maglev-specific: 1-2 per quarter.
- Turbolev: 0 CVEs yet (pre-release path).

## 5. GC and the heap

`src/heap/` (326 files) implements Orinoco — V8's incremental, concurrent, generational GC.

Key invariants the GC maintains (and that bugs violate):

- **Write barrier completeness**: every cross-generational pointer write must inform the remembered set. Missing barriers → use-after-free on minor GC.
- **Ephemeron correctness**: weak-key maps must clear values when keys die. CVE-2021-37975 was an ephemeron marking UAF.
- **Concurrent marking safety**: mutator (JS) writes can race with marker. Black-allocation, dirty-card tracking, and snapshot-at-the-beginning protocols must be atomic with respect to specific operations.
- **Compaction validity**: when compacting, all incoming pointers must be relocated. Stale pointers across compaction → arbitrary write.
- **Pinning across foreign code**: when JS calls into C++ embedder code that holds raw pointers, those objects must be pinned. Violations → UAF when GC moves them.
- **Safepoints in JIT**: optimizing compilers must annotate every point where GC can run with a stack map. Missing or wrong stack maps → mis-relocation of live values.

The interaction surface between GC and the JIT compilers is one of the highest-yield bug zones (CVE-2021-37975, CVE-2024-6773, CVE-2025-12432). Fuzzers struggle to reach because triggering requires precise GC timing.

## 6. Sandbox model in detail

The sandbox replaces raw pointers with the following, depending on what's being referenced:

- **Sandboxed pointer**: 32-bit offset from sandbox base. For pointers staying inside the sandbox heap.
- **External pointer**: 32-bit index into the **External Pointer Table (EPT)**, which lives outside the sandbox. The table entry holds the raw out-of-sandbox pointer plus a tag identifying the expected use. Mismatched tag = abort.
- **Indirect pointer**: similar to external pointer but for trusted objects (objects whose integrity is required). Stored in the **Trusted Pointer Table (TPT)**.
- **Code pointer**: index into the **Code Pointer Table (CPT)**, which holds JIT-compiled code entry points. JS dispatch goes through the **JS Dispatch Table** for additional validation.
- **Bounded size**: integer with type-encoded upper bound. Reading sees a value clamped to the bound.

Bypass classes that have been published:

- Forging table indices (when a writeable in-sandbox object holds a "trusted" 32-bit value).
- Type-confusing two pointer types that share a tag space (CVE-class).
- Wasm escape via raw pointers held in linear-memory descriptors.
- Snapshot deserialization producing a TPT entry the runtime later trusts.
- PartitionAlloc metadata corruption through a memory primitive.

## 7. Inputs at each boundary (what is attacker-controlled)

| Boundary | Attacker input | Example sink |
|---|---|---|
| B2 (JS source) | Source string | Parser scope chain (CVE-2024-5274) |
| B2 (JS runtime) | Object shape transitions, prototype chains, IC feedback | TurboFan typer (many CVEs) |
| B3 (Wasm bytes) | Type section, code section, table init, GC type hierarchy, exception tables | Wasm decoder, Liftoff codegen (CVE-2024-2887) |
| B4 (Builtins) | Receiver type, argument types, large index, detached typed array, proxy, frozen object, prototype mutation during call | Torque builtin missing bounds (Issue 2046) |
| B4 (RegExp) | Pattern, flags (`/v`), case-folding, very long inputs | Irregexp interpreter, JIT |
| B5 (Sandbox) | Arbitrary R/W in sandbox region after a primitive | Pointer table corruption, raw pointer materialization |

## 8. Implicit invariants the runtime assumes

Pulled from reading subsystem READMEs and source comments. These are unstated assumptions that, when violated, produce CVE-class bugs.

1. **Map (hidden class) integrity**: an object's `Map` pointer determines its layout. Anything that produces an object whose `Map` says "X" but whose memory looks like "Y" causes a type confusion. (Most TurboFan / Maglev CVEs.)
2. **Stable types across an optimization phase**: a node's type at the start of a reducer pass must match its type at the end, except where the pass deliberately retypes. Violations show up as "load X assumed to be SMI loaded as HeapObject" (Turboshaft store-store elim).
3. **Bytecode integrity**: handlers do not re-validate operands. Bytecode arrays are not protected by the sandbox in older modes (active hardening project).
4. **Receiver type matches call site**: every JS call through an IC site assumes the receiver matches the cached map. Polymorphic IC handles N maps; megamorphic falls back. Bugs land when an IC handler handles N+1 maps without re-checking.
5. **GC safepoints are exhaustive**: every point in JIT code where GC could run is annotated with a stack map. Missing safepoint → live pointer not visited.
6. **Wasm modules are validated before execution**: the decoder must reject any module that breaks the Wasm spec. Bugs are usually decoder / type-system gaps (CVE-2024-2887, GC subtype confusion).
7. **External pointer tags are unique per use**: tag mismatches abort. A bug that lets two distinct uses share a tag is a sandbox bypass.
8. **API objects' embedder fields are out-of-sandbox**: if anything writes an in-sandbox value into an embedder-field, sandbox is violated.
9. **Snapshot startup data is signed and self-consistent**: deserialization assumes no tampering. Custom snapshots (Node.js) shift this assumption to the embedder.
10. **Concurrent marker invariants**: SATB (snapshot-at-the-beginning) requires that any pointer overwritten during marking is marked. Missing marker invocations → premature collection.
11. **Re-entrancy from C++ to JS**: builtins that call out to user JS (e.g., via `valueOf`, `toJSON`, proxy traps) must restore state before returning. Re-entrancy bugs are a recurring class.
12. **RegExp anchors**: `^` and `$` semantics with multi-line, sticky, and unicodeSets flags. Recent regressions in `/v` flag area.

## 9. Out-of-scope or low-value surfaces (for this engagement)

- **Public C++ API stability bugs** — embedder problem, not V8 RCE.
- **Inspector / DevTools UI** — mostly logic, low yield.
- **Profiler / tracing** — instrumentation surface, side-channel only.
- **Tooling under `tools/`, `samples/`, `cppgc-js/cppgc/`** — tests and samples, not shipped V8 binary.
- **`src/asmjs/`** — legacy asm.js, low traffic, low yield.

## 10. Recommended hunt focus, derived

Combining this architectural model + the CVE recon + the bug-discovery survey:

**P1 surfaces (where bug class × under-research × analytical leverage all align):**

1. **Turboshaft reducer set** (`src/compiler/turboshaft/`) — 33% of CVEs are JIT type confusion, Turboshaft is replacing TurboFan, two confirmed reducer-pass CVEs (2025-5419, 2024-6773), full pass set unaudited.
2. **Maglev phi untagging and object allocation** (`src/maglev/`) — CVE-2026-3910 is the most recent public writeup, fewer public researchers, more under-explored than TurboFan.
3. **Wasm GC types and exception handling** (`src/wasm/`) — Wasm 3.0 GC + exnref + memory64 finalized late 2025; in-tree fuzzer is byte-level not grammar-aware.
4. **GC × JIT interaction** (`src/heap/` × `src/compiler/`, `src/maglev/`) — produces UAF on arbitrary objects, lowest fuzzer reach.
5. **"Inappropriate implementation" / logic bugs** (anywhere — Temporal, RegExp /v, Iterator helpers, async generators) — 38% of 2026 V8 CVEs, AI / human reading wins over fuzzers here.

**P2 surfaces:**

- Bytecode-trust-model erosion via sandbox primitive (`src/interpreter/` × `src/sandbox/`).
- JSON parser + reviver (`src/json/`) — under-fuzzed for GC during reviver callbacks.
- Snapshot deserialization for embedder-custom snapshots (`src/snapshot/`) — Node/Deno/Electron specific.
- RegExp non-backtracking engine and `/v` flag (`src/regexp/`).

**P3 / parking:**

- Parser scope-chain bugs — CVE-2024-5274 territory, low frequency in 2025-2026.
- Sparkplug — small surface, less optimized therefore less type-magic to break.
- Direct sandbox primitives — high-skill, high-yield, but Google explicitly classes sandbox bugs as "not yet a security boundary" — VRP economics are weaker until that changes.

## 11. Companion documents

- **Minimal threat model**: `2026-04-27-v8-minimal-threat-model.md` — one-page working set for prompt-sized V8 hunting.
- **CVE recon 2025-2026**: `2026-04-26-v8-cve-recon-2025-2026.md` — 69 V8 CVEs, by class / month / severity / discoverer.
- **Batch fix-lineage seed**: `2026-04-27-v8-batch-fix-lineage-seed.md` — compact Phase C input for the Oct 2025 and Apr 2026 V8 release clusters.
- **Bug-discovery survey**: `2026-04-26-v8-bug-discovery-survey.md` — taxonomy of techniques + saturation map + tooling + AI-leverage section.
- **Phase B + D matrix**: `2026-04-26-v8-invariants-and-hunt-matrix.md` — file:line invariants plus the active candidate set.

## 12. Open questions for the next phase

1. Which P1 surface gets the next probe slice? Options: Turboshaft passes, Maglev untagging, Wasm 3.0 GC, GC × JIT, or the logic / "Inappropriate implementation" cluster.
2. Patch-frequency heatmap: do we run `git log --since=1.year --grep="security"` against `src/` and rank components by hot/cold? (Quick to do once chosen.)
3. Bug class quotas for hunt matrix: enforce ≤30% JIT type confusion, ≥30% logic class, ≥10% under-explored corner, ≥10% variant-cluster from a batched release. Confirm or revise before generating candidates.
