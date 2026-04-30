# AGENTS.md — V8 Engagement Context for OpenCode

This file briefs an OpenCode session that picks up the V8 vulnerability hunt midway. Read it end-to-end before doing anything. Companion file: `CLAUDE.md` in the same directory (older conventions, mostly compatible).

## What we are doing

Vulnerability hunting on **V8 14.8.178.9** (Chrome 148 stable). Goal: VRP-grade memory safety bugs (type confusion, UAF, OOB) or spec-level "Inappropriate implementation" bugs in the JS engine. Out of scope: Chrome browser-wide (Blink, IPC, GPU). In scope: V8 core (compiler, runtime, GC, RegExp, Wasm, Temporal, sandbox).

The work is mid-engagement. Phases A (CVE-derived threat model) and the boundary inventory + invariants extraction are done. Phase F (probing) was attempted via a `codex:codex-rescue` subagent bridge and **the bridge is broken** for long-running tasks against this target. Continue with bash-driven hunting (you write PoCs, you run d8, you analyse output).

## Paths you will use constantly

```
V8_ROOT           = /Users/carlosgomez/v8-engagement/v8/v8           (~6.6 GB source)
D8_ASAN           = /Users/carlosgomez/v8-engagement/v8/v8/out/asan/d8
                    (183 MB, built with ASan + DCHECK + verify_heap + dcheck_always_on + symbol_level=2 + verify_heap)
D8_RELEASE        = /Users/carlosgomez/v8-engagement/v8/v8/out/release/d8
                    (43 MB, optimized — for differential repro testing)
REPRO_SH          = /Users/carlosgomez/v8-engagement/scratch/repro.sh
SCRATCH           = /Users/carlosgomez/v8-engagement/scratch          (helpers + smoke files)
DEPOT_TOOLS       = /Users/carlosgomez/v8-engagement/depot_tools
SETUP_LOG         = /Users/carlosgomez/v8-engagement/build-logs/SETUP.md
BUGS_DIR          = /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/v8/
THREAT_MODELS_DIR = /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/docs/threat-models/
METHODOLOGY_DIR   = /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/docs/methodology/
```

The pointer file `targets/v8/PATH.txt` mirrors these.

## Phase A artifacts — read these before hunting

Located under `docs/threat-models/`:

1. **`2026-04-27-v8-minimal-threat-model.md`** ← **read this first**
   - one-page working set: attacker model, accepted bug classes, trust boundaries, and P1 surfaces
   - intended as the default context for a V8 hunt slice
   - keeps the threat model compact so it improves signal instead of becoming prompt bloat

2. **`2026-04-26-v8-cve-recon-2025-2026.md`**
   - 69 V8/Turbofan/Maglev CVEs Jan 2025 → Apr 2026 classified by class / month / severity
   - Bug class shift: TypeConfusion 34% -> "Inappropriate implementation" jumped 14% -> 38% in 2026
   - Two batched-release variant clusters identified: **2025-10-28 (11 V8 CVEs)** and **2026-04-07 (6 V8 CVEs)** — patch-diff these for a class fingerprint
   - Notable credits: Seunghyun Lee, Google Big Sleep (their own AI agent)

3. **`2026-04-27-v8-batch-fix-lineage-seed.md`**
   - minimal Phase C input for the two public V8 batch clusters
   - intentionally short: enough to steer variants without dragging a full lineage doc into every prompt

4. **`2026-04-26-v8-invariants-and-hunt-matrix.md`** ← **the operational doc**
   - 9 surfaces (S1-S9) with invariants cited file:line
   - 18 candidates (C1-C18)
   - Anti-anchoring diversity gate (≤30% JIT type confusion, ≥30% logic class, ≥10% variant cluster, ≥10% under-explored corner)
   - Priority ordering for Phase F

5. **`2026-04-26-v8-architectural-threat-model.md`**
   - 5 trust boundaries (B1 embedder, B2 JS source, B3 Wasm bytes, B4 builtins, B5 sandbox internal)
   - 24 subsystems mapped to `src/` directories with file counts
   - 12 implicit invariants the runtime assumes
   - V8 sandbox model (External Pointer Table, Trusted Pointer Table, Code Pointer Table, JS Dispatch Table, sandboxed pointers)
   - reference lookup only; do not stuff this whole doc into a probe prompt

6. **`2026-04-26-v8-bug-discovery-survey.md`**
   - 13 discovery techniques + saturation 2026 assessment
   - Component yield map (TurboFan saturated for classic patterns, Turbolev = 0 CVEs untouched)
   - 10 under-explored corners (Turbolev, Turboshaft reducers, Wasm 3.0 GC, GC×JIT, bytecode trust, etc)
   - "AI Leverage vs Fuzzer Leverage" section: do not write fuzzers from scratch; use cognitive leverage on patch-diff, spec-diff, source audit, cross-component pattern transfer

Read the compact threat model first, then the recon / lineage seed, then the hunt matrix. Do not stack all of these into one prompt. One candidate, one slice, one violated contract.

## The 18 candidates (Phase D matrix)

| Surface | Files | Candidates | Priority |
|---|---|---|---|
| S1 Maglev phi untagging | `src/maglev/maglev-phi-representation-selector.cc` | C1, C2 | P2 |
| S2 Turboshaft load elim | `src/compiler/turboshaft/late-load-elimination-reducer.h` | **C3, C4** | **P1** |
| S3 Machine lowering | `src/compiler/turboshaft/machine-lowering-reducer-inl.h` | C5, C6 | P2 |
| S4 Wasm canonical types | `src/wasm/canonical-types.cc` | C7, C8 | P1 |
| S5 Wasm Liftoff arm64 | `src/wasm/baseline/liftoff-compiler.cc` | C9, C10 | P2 |
| S6 GC × marker race | `src/heap/incremental-marking.cc`, `heap-write-barrier.cc` | C11, C12 | P1 |
| S7 Temporal API | `src/objects/js-temporal-objects.cc` (7014 lines!) | **C13, C14, C15** | **P1** |
| S8 RegExp /v flag | `src/regexp/regexp-parser.cc` | **C16, C17** | **P1** |
| S9 Bytecode trust | `src/interpreter/`, `src/sandbox/bytecode-verifier.cc` | C18 | P3 |

Read the invariants matrix doc for the full hypothesis per candidate.

## What is already verified

- Build pipeline works: `D8_ASAN` runs, `repro.sh` wraps with ASan options + symbolizer, smoke `%SystemBreak()` triggers SIGTRAP exit 133, ASan symbolization is wired.
- Differential testing works: same JS through `D8_ASAN` vs `D8_RELEASE` exposes ASan-only DCHECK fires.
- Network egress for ECMA spec / TC39 / Chromium issue tracker reachable.

## What does NOT work — known issues

1. **`codex:codex-rescue` subagent bridge is broken for long V8 tasks.** Companion script timeouts at 10 min, returns fake "background ID X" — the actual job never runs. Three rounds attempted, all produced empty output dirs. Do NOT use codex-rescue for this engagement.
2. **`timeout` does not exist on macOS.** Use `/opt/homebrew/bin/gtimeout` (from `brew install coreutils`).
3. **System Node is v25.9.0**; V8 build needed `node@22` from `/opt/homebrew/opt/node@22/bin/node`. For our hunting we use d8 directly so this is moot — but note if you need npm/npx for Wasm tooling.
4. **V8 SSR-style anti-defense applies to its own probes**: when running d8 in environments that auto-apply hardening flags, certain features may be disabled. Use the flag set in `repro.sh` (currently `--allow-natives-syntax --expose-gc --turbofan --maglev`).

## What was found so far

**One sub-VRP finding:**

- **H5 Temporal duplicate calendar annotations silently accepted** (in `bugs/v8/c13-temporal-specdiff/` round 1):
  ```
  Temporal.PlainDate.from("2020-01-01[u-ca=gregory][u-ca=iso8601]") → "2020-01-01[u-ca=gregory]"
  Temporal.PlainDate.from("2020-01-01[u-ca=iso8601][u-ca=gregory]") → "2020-01-01"  // both dropped
  ```
  - TC39 spec requires `RangeError`. Bug lives in `temporal_rs` Rust crate vendored at `js-temporal-objects.cc:2614-2632`.
  - Class: spec compliance / "Inappropriate implementation". Sub-VRP threshold (no integrity/confidentiality).
  - Reportable to V8 issue tracker + `temporal_rs` upstream, not VRP.
  - Catalogued as primitive: "Calendar-annotation parser confusion".

**Refuted by round 1 (do not re-test these):**

- H1 — `MAX_SAFE_INTEGER` year in `Temporal.PlainDate.from()` is rejected by `CheckDoubleInRange<int32_t>` at `js-temporal-objects.cc:1753-1795`.
- H2 — Step ordering matches spec: V8 reads `[calendar, day, month, year, overflow]`.
- H4 — Duration arithmetic delegates to Rust crate with checked arithmetic.
- H3 was inconclusive (DCHECK only in debug, tested values passed). Worth re-probing with new shapes if time allows.

## Hunting workflow (bash-driven)

Before writing a PoC, use `docs/methodology/minimal-vulnhunt-loop.md`.
Every candidate needs a concrete invariant, entry point, trust boundary, sink,
canonical runtime, oracle, reportability bar, and stop condition. Minimal PoC is
good; fake scaffold is not evidence.

Per candidate:

1. **Read the invariants for that surface in `2026-04-26-v8-invariants-and-hunt-matrix.md`.**
2. **Read the cited file:line range in source** (open the actual `.cc` / `.h`).
3. **Form 3-5 hypotheses** of how an invariant could be violated. For each: function:line, JS sequence shape, expected violation.
4. **Write the smallest possible PoC** in `bugs/v8/<candidate-id>/poc/h<N>.js` (≤50 lines).
5. **Run via `bash $REPRO_SH path/to/h<N>.js`** and capture stdout+stderr to `bugs/v8/<candidate-id>/evidence/h<N>.txt`.
6. **Differential**: same PoC through `D8_RELEASE` directly. If outputs diverge, that is signal.
7. **Verdict** in `bugs/v8/<candidate-id>/VERDICT.md` per hypothesis. One of:
   - `CONFIRMED-CRASH` — paste ASan / DCHECK output verbatim with addresses + stack
   - `CONFIRMED-DIVERGENCE` — paste V8 output + spec-required output with TC39 spec section URL
   - `CONFIRMED-MISCOMPILE` — paste interpreter vs Turboshaft outputs side by side
   - `REFUTED` — cite the protective code path with file:line
   - `INCONCLUSIVE` — name the missing piece (must be infra-level, not "it's hard")
8. **`WALKTHROUGH.md`** narrates what was looked at, what was refuted, why.
9. If CONFIRMED → primitive catalog entry, then chain analysis, then VRP report.

## Next candidates to probe (priority order, after the 3 attempted)

The 3 P1 attempted via codex-rescue (all failed): **C13 Temporal**, **C3 Turboshaft load elim**, **C16 RegExp /v**. Round 1 of C13 produced H5 (above); C3 and C16 never produced any PoC.

Next priorities for bash-driven hunting:

1. **C13 (Temporal) — re-probe deeper**, with the H5 finding catalogued. Look for ICU integration bugs (DurationFormat × Intl) and non-Gregorian calendar edge cases that round 1 did not test.
2. **C3 (Turboshaft load elim) — variant of CVE-2024-6773 / CVE-2025-5419**. Read `late-load-elimination-reducer.h:200-500` (analysis loop + replacement logic + aliasing). Build JS that produces the suspect IR shape, force Turboshaft, differential against interpreter. Public writeup template: `https://bushido-sec.com/index.php/2025/01/27/cve-2024-6773-type-confusion-in-v8/`.
3. **C16 (RegExp /v) — case-fold + string members + property escapes**. Read `regexp-parser.cc:90-300`. Build patterns with `[\q{...}]` containing case-foldable code points across surrogate boundaries. Differential against test262.
4. **C7 (Wasm canonical types)** — Wasm 3.0 GC subtypes, recursion groups, `(ref null T)` vs `(ref T)` import-time check. Need a small Wasm module generator (binaryen or wabt-cli).
5. **C11 (GC × marker race)** — `--stress-marking --stress-incremental-marking`, SharedArrayBuffer + Atomics writes. Big Sleep precedent (CVE-2025-12432).

Per the methodology anti-anchoring rules, do NOT make all candidates JIT type confusion. Mix logic, JIT, and Wasm.

## Useful d8 flags

```
--allow-natives-syntax       # enables %DebugPrint, %OptimizeFunctionOnNextCall, %SystemBreak, etc
--expose-gc                  # exposes gc() function
--turbofan / --no-turbofan   # toggle TurboFan tier
--maglev / --no-maglev       # toggle Maglev tier
--turboshaft-trace-reduction # log Turboshaft reducer firings
--trace-turbo                # IR dump
--trace-maglev               # Maglev compilation trace
--trace-gc                   # GC events
--stress-marking             # force frequent incremental marking
--stress-incremental-marking
--stress-maglev
--gc-interval=N              # trigger GC every N allocations
--print-bytecode             # print bytecode
--print-regexp-bytecode      # print regexp bytecode
--trace-regexp-parser        # parser decisions
--print-opt-code             # print optimized code
--no-lazy                    # eager parse all
--single-threaded            # disable concurrent compile
```

## Methodology rules (V8-relevant subset)

From `docs/methodology/vulnhunt-methodology.md` rules 12-19:

- Slice discipline: ≤3 KB project text per agent prompt. (Moot if you do not use agents.)
- Adversarial framing: "demonstrate the bug at file:line N", not "is this safe?"
- Production deployment verification (F.0.1): the runtime that serves real users is `d8` standalone for our hunt; `out/asan/d8` IS the production-equivalent build for our purposes.
- Pin runtime/binary by absolute path in shell calls. Sub-shells lose env.
- macOS infra: use `gtimeout` not `timeout`.
- Frameworks have their own anti-defenses. V8 has the sandbox; bug class severity changes if it crosses the sandbox boundary.
- Rule 19: do not write a fuzzer from scratch for this target. Google has industrial-scale fuzzing infra. Compete on cognitive leverage: source audit, patch-diff, spec-diff, cross-component pattern transfer, post-fuzz triage.

## Coverage so far

```
S1 Maglev phi          [   ]  not started
S2 Turboshaft loadelim [   ]  C3 attempted via codex (failed), no real probe
S3 Machine lowering    [   ]  not started
S4 Wasm canonical      [   ]  not started
S5 Wasm Liftoff arm64  [   ]  not started
S6 GC × marker         [   ]  not started
S7 Temporal API        [✓✓✓]  C13 round 1 produced H5 (sub-VRP)
S8 RegExp /v           [   ]  C16 attempted via codex (failed), no real probe
S9 Bytecode trust      [   ]  not started (P3, may park)
```

Effective coverage: 1/9 surfaces touched (S7 only, partially).

## Hand-off checklist for the next session

- [ ] Read this file end-to-end.
- [ ] Read the invariants matrix doc.
- [ ] Verify smoke: `bash /Users/carlosgomez/v8-engagement/scratch/repro.sh /Users/carlosgomez/v8-engagement/scratch/smoke-crash.js` — should exit 133 (SIGTRAP from `%SystemBreak`).
- [ ] Pick a candidate from the priority list above.
- [ ] Hunt bash-driven (do NOT delegate to `codex:codex-rescue`; the bridge is broken for this target).
- [ ] Write artifacts under `bugs/v8/<candidate-id>/`.
- [ ] When verdict is CONFIRMED with integrity/confidentiality impact, follow `vulnhunt-methodology.md` Phase H (CVSS) and Phase I (report) for VRP submission.
- [ ] When verdict is sub-VRP (logic only), catalog as primitive and continue. Chain analysis after multiple primitives accumulate.

## Disk / build environment

- Total `~/v8-engagement`: ~26 GB used (out of 240 GB available).
- macOS arm64. SDK 26.4. clang from depot_tools (LLVM 23.0.0git).
- depot_tools sha pinned in `SETUP.md`.
- V8 source pinned at `branch-heads/14.8`, sha `209cf3b52af1ac949a6774ccd0b8843958fbab9d`, version `14.8.178.9`.

## When to stop

- VRP-grade primitive landed → switch to report-writing.
- 3 consecutive REFUTED candidates with no new code paths surfacing → re-enter Phase E (boundary inventory) for the next hunt round.
- All P1 candidates closed → consider P2 or move to a different target.
