# V8 Bug Discovery Survey — Phase A Pre-Engagement Research

**Date:** 2026-04-26
**Purpose:** Map historical V8 vulnerability discovery to inform a fresh hunt, explicitly combating anchoring toward JIT type confusion.

---

## Section 1 — Discovery Technique Taxonomy

### 1.1 Coverage-Guided Fuzzing (libFuzzer / OSS-Fuzz)

V8 ships in-tree libFuzzer harnesses (`test/fuzzer/`) for JSON, regexp, wasm compile/code, and parser. OSS-Fuzz runs continuously. Effective at shaking out decoder/parser bugs; poor at reaching deep JIT paths requiring semantically valid multi-stage JS.

**Saturation:** High for harnessed components. Low for JIT backends, GC interactions, builtins (no dedicated harnesses).
- [V8 test/fuzzer](https://chromium.googlesource.com/v8/v8/+/refs/heads/lkgr/test/fuzzer/)

### 1.2 Grammar-Based JS Fuzzing (Fuzzilli, Domato)

Fuzzilli generates semantically valid JS via FuzzIL IR with coverage feedback. Primary tool for finding JIT compiler bugs. Domato uses context-free grammars, historically stronger on DOM/browser APIs.

**Saturation:** Saturated for TurboFan passes (years of continuous fuzzing). Moderate for Maglev. Low for Turboshaft-specific passes and Turbolev.
- [Fuzzilli](https://github.com/googleprojectzero/fuzzilli), [NDSS 2023 paper](https://www.semanticscholar.org/paper/089f134f93a436f981a531d063bd990f9f111e86)

### 1.3 Differential Execution

Compare output across V8 configurations (interpreter-only, Maglev, TurboFan, Turboshaft). Mismatches indicate miscompilation. CVE-2024-7965 was a Maglev miscompilation exploited in-the-wild ([Cyble analysis](https://cyble.com/blog/high-risk-cve-2024-7965-vulnerability-in-chromes-v8-engine-requires-quick-fix/)).

**Saturation:** Moderate. Under-applied to Maglev-vs-TurboFan and Turboshaft-vs-legacy comparisons.

### 1.4 Source Audit of Optimization Passes

Manual review of compiler passes for invariant violations. Historically productive: bounds elimination, escape analysis, typer in TurboFan; phi untagging, object allocation in Maglev; load/store elimination in Turboshaft.

**Saturation:** Saturated for classic TurboFan passes. Fresh for Turboshaft reducers and Maglev's newer phases.
- CVE-2023-4069: [Maglev incomplete init](https://github.blog/security/vulnerability-research/getting-rce-in-chrome-with-incomplete-object-initialization-in-the-maglev-compiler/)
- CVE-2025-5419: [Turboshaft store-store elim](https://cvefeed.io/vuln/detail/CVE-2025-5419)
- CVE-2026-3910: [Maglev phi untagging](https://cvereports.com/reports/CVE-2026-3910)

### 1.5 Patch Diff / Variant Analysis

Monitor V8 commits for security fixes; diff reveals bug patterns for variant hunting. Every fix is a template.

**Saturation:** Perpetually renewable. Under-exploited for Turboshaft and Maglev patches specifically.
- [Patch gap to mobile RCE (osec.io)](https://osec.io/blog/2026-04-01-patch-gap-to-mobile-renderer-rce/)

### 1.6 Spec Differential (TC39 vs Implementation)

Compare ECMA-262/402 spec text against V8 for edge-case gaps. CVE-2019-5790 came from regexp spec analysis ([Bluefrost](https://labs.bluefrostsecurity.de/blog/2019/04/29/dont-follow-the-masses-bug-hunting-in-javascript-engines/)).

**Saturation:** Low. Labor-intensive, rarely pursued. High novelty for new spec features (Temporal, Iterator Helpers, Set methods).

### 1.7 Regexp Engine Fuzzing

V8 has backtracking Irregexp and a newer non-backtracking engine (2023). In-tree harness exists. `/v` (unicodeSets) flag is recent surface.

**Saturation:** Moderate for backtracking. Low for non-backtracking engine and `/v` flag.
- [Non-backtracking engine](https://v8.dev/blog/non-backtracking-regexp)

### 1.8 WebAssembly Fuzzing

Seunghyun Lee found 10+ Wasm bugs in ~2 months, winning Pwn2Own 2024 and $250K+ total ([CODE BLUE 2024](https://archive.codeblue.jp/2024/en/program/time-table/day2-111/)). CVE-2024-2887: Wasm type section confusion enabling universal type confusion ([ZDI](https://www.thezdi.com/blog/2024/5/2/cve-2024-2887-a-pwn2own-winning-bug-in-google-chrome)).

**Saturation:** Moderate for decoder. Low for GC proposal types, exception handling (exnref), memory64, multi-memory.

### 1.9 GC Stress Testing

Trigger GC at adversarial points during optimization/allocation. CVE-2021-37975: ephemeron marking UAF gave arbitrary object free ([GitHub Blog](https://github.blog/security/vulnerability-research/chrome-in-the-wild-bug-analysis-cve-2021-37975/)). CVE-2024-6773: Turboshaft stale pointer during GC.

**Saturation:** Low. Rare but high-value. GC-compiler interaction for new tiers is under-tested.

### 1.10 Snapshot / Startup Serialization

V8 snapshots bake heap state for fast startup. Hash flooding fix was the only major public security work ([V8 blog](https://v8.dev/blog/hash-flooding)). Custom snapshots in Node.js/Deno/Bun expand surface.

**Saturation:** Very low. Almost unexplored.

### 1.11 Builtin / Torque Review

Audit Torque builtins for missing bounds checks or fast/slow path inconsistencies. Issue 2046: missing max-length check in Torque array allocation led to RCE ([elttam](https://www.elttam.com/blog/simple-bugs-with-complex-exploits)).

**Saturation:** Low-to-moderate. New builtins (Temporal, Iterator Helpers) lack equivalent scrutiny.

### 1.12 V8 Sandbox Escape Research

Given in-sandbox R/W, find escape to full-process access. Active arms race with 90+ tracked bypasses ([collection](https://github.com/xv0nfers/V8-sbx-bypass-collection)). Key vectors: Wasm raw pointers ([Theori](https://theori.io/blog/a-deep-dive-into-v8-sandbox-escape-technique-used-in-in-the-wild-exploit)), trusted pointer table ([HITCON 2024](https://mem2019.github.io/jekyll/update/2024/07/14/HITCON.html)), PartitionAlloc metadata.

**Saturation:** Moderate-to-high for known classes (raw pointers being banned). Sandbox is NOT yet a formal security boundary.

---

## Section 2 — Component Yield Map

| Component | High-yield bug classes | Est. public CVEs | Saturation 2026 |
|---|---|---|---|
| **TurboFan optimizer** | Type confusion (typer, bounds elim, escape analysis) | 50+ | Saturated for classic patterns; Turboshaft backend passes newer |
| **Maglev (mid-tier JIT)** | Incomplete init, phi untagging, IC mishandling | 10-15 | Growing — less fuzzed than TurboFan |
| **Turbolev (new top-tier)** | Unknown — Maglev frontend + Turboshaft backend | 0 | Untouched. Maximum novelty |
| **Ignition interpreter** | Try/catch handler confusion, SuperIC type confusion | 5-10 | Low. Bytecode trusted under sandbox model |
| **Irregexp** | Integer overflow, case-folding, backtracking complexity | 3-5 | Low. Non-backtracking engine and `/v` flag are new |
| **Parser / Scanner** | Scope chain confusion (CVE-2024-5274) | 3-5 | Low. Parser bugs cascade to type confusion via bytecode mismatch |
| **GC (Orinoco)** | Ephemeron UAF, write barrier misses, concurrent races | 3-5 | Very low. Rare, high-impact, under-researched for new tiers |
| **Wasm (Liftoff + Turboshaft)** | Type section confusion, GC type aliasing, sig mismatches | 20+ | Moderate for decoder; low for GC/exception/memory64 |
| **Builtins (Torque/CSA)** | Missing bounds checks, fast/slow inconsistency | 10+ | Moderate. New APIs (Temporal, Set methods) are fresh |
| **Snapshots / startup** | Hash flooding, deserialization inconsistency | 1-2 | Very low |
| **V8 Sandbox enforcement** | Raw pointer escapes, TPT corruption, PartitionAlloc | 90+ bypasses | Active arms race |
| **Bytecode handlers** | Trusted bytecode corruption for sandbox bypass | 1-2 | Very low. Worth testing trusted-bytecode assumption |
| **JSON parser** | Reviver interaction, serializer OOB | 1-2 | Very low |
| **Intl / Temporal** | ICU integration, new API surface | ~0 | Untouched |

---

## Section 3 — Under-Explored Corners

**3.1 Turbolev.** Replaces TurboFan frontend with Maglev IR feeding into Turboshaft backend. Under development since mid-2025 ([blog](https://blog.seokho.dev/development/2025/07/15/V8-Expanding-To-Turbolev.html)). Zero public security research. Novel IR combination creates untested interaction surfaces. *Unlock:* Source audit of lowering phases; differential execution across all tiers.

**3.2 Turboshaft optimization passes.** CVE-2024-6773 (load elimination) and CVE-2025-5419 (store-store elimination) prove bugs exist. Full pass set not systematically audited. *Unlock:* Enumerate all reducer passes; check for stale pointers across GC safepoints.

**3.3 Wasm 3.0 features.** GC types, exception handling (exnref), memory64, multi-memory — all standardized Sept 2025 ([W3C](https://github.com/WebAssembly/proposals/blob/main/finished-proposals.md)). In-tree wasm fuzzer produces random bytes, not structurally valid GC modules. *Unlock:* Custom grammar-based generator targeting GC type hierarchies.

**3.4 GC-compiler interactions.** Two high-value CVEs (2021-37975, 2024-6773) demonstrate this class. Interaction between concurrent GC and Maglev/Turboshaft is under-tested. *Unlock:* `--stress-marking --stress-maglev --gc-interval=500` combined with Fuzzilli or targeted programs.

**3.5 Maglev on arm64.** Architecture-specific codegen bugs are common. Most researchers test x64 only. *Unlock:* Fuzzilli/differential tests on arm64 builds.

**3.6 Temporal API and new builtins.** Large new surface landing progressively. No dedicated security fuzz harnesses. *Unlock:* Spec-differential testing against reference polyfill.

**3.7 Ignition bytecode as trusted code.** Bytecode lives inside sandbox but is trusted by interpreter. Corrupting bytecode arrays bypasses sandbox without needing a separate escape. CVE-2025-10891 demonstrated try/catch handler offset manipulation. *Unlock:* Map bytecode operands that give R/W in trusted space if corrupted.

**3.8 JSON parser + reviver.** `JsonStringifier::SerializeString` OOB in sandbox bypass collection. Interactions with complex reviver callbacks during GC are untested. *Unlock:* Fuzz JSON.parse with reviver callbacks that trigger GC.

**3.9 SharedArrayBuffer / Atomics races.** Hard to trigger deterministically. Fuzzers are poor at concurrent state spaces. *Unlock:* TSan builds + targeted stress tests around Atomics.wait/notify interacting with GC/deopt.

**3.10 Structured clone.** ValueSerializer/Deserializer handles complex object graphs for postMessage/IndexedDB. Not accessible from d8. *Unlock:* Build d8-level harness exercising serializer directly.

---

## Section 4 — Tooling

| Tool | Target | Status | URL |
|---|---|---|---|
| Fuzzilli | JS JIT compilers | Active | [GitHub](https://github.com/googleprojectzero/fuzzilli) |
| V8 in-tree fuzzers | JSON, regexp, wasm, parser | Active (OSS-Fuzz) | [Source](https://chromium.googlesource.com/v8/v8/+/refs/heads/lkgr/test/fuzzer/) |
| Domato | DOM/grammar-based | Maintained | [GitHub](https://github.com/googleprojectzero/domato) |
| Weaver | JS-Wasm boundary | Research (2026) | [Paper](https://arxiv.org/html/2603.18789v1) |

**Sanitizers:** ASan (UAF, overflow), UBSan (integer overflow, UB), MSan (uninit reads), TSan (data races) — all supported in V8 GN builds.

**Key debug flags:** `--trace-turbo`, `--trace-maglev`, `--turboshaft-trace-reduction`, `--print-bytecode`, `%DebugPrint()`, `--trace-gc`, `--allow-natives-syntax`, `--stress-marking`, `--stress-maglev`, `--gc-interval=N`.

**External resources:**
- [V8 sandbox bypass collection (90+)](https://github.com/xv0nfers/V8-sbx-bypass-collection)
- [V8/Chrome reading list (Zon8)](https://zon8.re/posts/v8-chrome-architecture-reading-list-for-vulnerability-researchers/)
- [V8 security resources](https://github.com/mwlik/v8-resources)
- [Project Zero 0-day RCAs](https://googleprojectzero.github.io/0days-in-the-wild/rca.html)

---

## Section 5 — Recommendations for This Engagement

### Target Components

1. **Turboshaft optimization passes.** Two confirmed CVEs prove bugs exist. Full pass set unaudited. Turboshaft now handles the entire Wasm pipeline and JS backend — it is the most code-critical compiler surface.

2. **WebAssembly 3.0 features.** Wasm was the highest-yield V8 surface in 2024 (Seunghyun Lee, 10+ bugs / 2 months). GC proposal types and exception handling are newer than what he targeted and lack grammar-aware fuzzers.

3. **GC-compiler interaction surface.** Produces UAF on arbitrary objects (CVE-2021-37975). Interaction with Maglev/Turboshaft compilation is under-tested and likely contains latent bugs.

### Techniques to Apply

1. **Source audit of Turboshaft reducer passes** — enumerate passes, check stale pointers across GC safepoints, verify type invariants at phase boundaries.

2. **Custom Wasm module generator** targeting GC proposal type hierarchies with subtyping, recursive groups, and exception handling flows.

3. **GC stress + JIT stress combination** — `--stress-marking --stress-maglev --gc-interval=500` with targeted programs to surface timing-dependent bugs.

### Anti-Anchoring Rule

**If the Phase A candidate matrix contains more than 30% TurboFan/Maglev type-confusion candidates, regenerate.** Classic JIT type confusion is the most-saturated technique applied to the most-saturated component. Allocate at least 50% of candidates to: Turboshaft passes, Wasm 3.0 features, GC interactions, bytecode trust model, and new API builtins.

---

---

## Section 6 — 2026 CVE Reality Check (Jan-Apr)

Survey above closed around late 2025. Pulled the 4 monthly Chrome stable changelogs Jan-Apr 2026 to validate saturation claims against fresh ground truth.

### V8-specific CVEs Jan-Apr 2026 (~21 total, ~5/month)

| Class | Count | Share | Implication for survey |
|---|---|---|---|
| Inappropriate implementation in V8 | 7 | 33% | Logic / spec divergence. NOT in original survey. Source-audit + spec-diff territory |
| Type Confusion (V8 / Turbofan) | 7 | 33% | Confirms saturation claim was overstated — bugs still flowing |
| OOB read/write in V8 | 4 | 19% | Boundary checks still missing in places |
| UAF in V8 | 2 | 10% | Mostly GC-adjacent |
| Object corruption / Integer overflow / Race | 3 | 14% | "Object corruption" is a new label (2026-5279); GC reentrancy or sandbox primitive |

### Notable patterns observed

- **April 7 release shipped 8 V8 CVEs in one batch** (`CVE-2026-5861..5873`). Cluster suggests variant hunting from a single root pattern. Patch-diff that release for a class fingerprint.
- **Turbofan got its own label** in April releases (e.g. `CVE-2026-6301`, `CVE-2026-6307` — Type Confusion in Turbofan). Maglev / Turboshaft still hidden under "V8" generic.
- **No "found by X" credits** in release notes. Tooling provenance not public. Patterns suggest:
  - Type confusion abundance → Fuzzilli-class grammar fuzzers
  - "Inappropriate implementation" → manual audit + spec diff
  - "Object corruption" → mix (GC stress + research)
  - Integer overflow → libfuzzer harness boundary review
  - Race → TSan or concurrent stress
- **WebML is the surprise** — multiple criticals every month, separate component. Out of scope for V8 hunt but worth noting.
- **Wasm-specific labels rare** in this window — fixes credited as "V8" or via `@angular/ssr`-style component naming. Wasm research from 2024 (Lee, Pwn2Own) may still be feeding the pipeline as variants.

### Survey corrections

- Original "saturation" assessment for TurboFan was too conservative. 7 type confusions in 4 months across V8/Turbofan label = continuous variant flow. Anti-anchoring rule still holds (don't make every candidate JIT type confusion) but treating JIT as "exhausted" is wrong.
- "Inappropriate implementation" is the largest single class and the survey omitted it entirely. Add as discovery technique 1.13.

### Implied technique 1.13 — Logic / spec audit

Audit V8 against ECMA-262 / TC39 spec, web platform tests, and Chromium docs for logic gaps. "Inappropriate implementation" CVE class typically means: spec says X, V8 does Y, the divergence is exploitable. Hard to fuzz (requires semantic understanding of intended behavior) and most rewarding for human/AI reading. **Saturation: low**. **Tooling: source reading, spec reading, web-platform-tests differential.**

---

## Section 7 — AI Leverage vs Fuzzer Leverage

Honest framing of where this engagement's analytical capability has comparative advantage and where it does not. Throwing a "mythical fuzzer" from a single workstation is a losing proposition.

### Where industrial fuzzing wins

| Capability | Owner | Why we cannot beat it |
|---|---|---|
| Throughput (samples / sec) | Google ClusterFuzz | 10⁶+ cores, continuous since 2012 |
| Coverage exploration | libFuzzer / Fuzzilli | Deterministic feedback loops, parallelizable |
| Regression detection at scale | Internal differential infra | Compares N-billion sample corpora |
| Crash deduplication | ClusterFuzz triage | Stack-hash + minimization pipeline |

Spending engagement time writing a hand-rolled fuzzer that competes with these is 3 orders of magnitude behind on day one.

### Where analytical hunting wins

| Capability | Why it is hard for fuzzers and good for human / AI |
|---|---|
| Patch-diff variant hunting | Reads 100s of security commits, correlates patterns, finds siblings the original fix did not touch. Fuzzer has no semantic model of "fix shape". |
| Spec differential (TC39 vs V8) | Requires reading both specs and reasoning about edge cases. Fuzzer has no oracle for "what should V8 do here". |
| Source audit of optimization passes | Reading reducers and arguing about invariants across phase boundaries. Fuzzer cannot reason about IR transformations. |
| Cross-component pattern transfer | "Bug X in module Y has the same shape as code Z in module W". Pure analytical. |
| Identifying under-explored corners | Synthesizing public literature + saturation maps. Fuzzer is blind to research history. |
| Fuzz output triage | Classifying thousands of crashes by root cause without reproducing each one. AI faster than human, fuzzer cannot do at all. |

### Engagement implication

Phase F (probing) for this V8 hunt:

1. We do **NOT** write a fuzzer from scratch.
2. We **DO** run existing fuzzers (Fuzzilli, V8 in-tree harnesses) as **instruments**, not as our intelligence.
3. AI / human time is spent on:
   - Pre-fuzzing reasoning (which target/component to point the fuzzer at, with which dictionary / grammar bias).
   - Post-fuzzing triage (which crashes are novel vs duplicates of public CVEs).
   - Source audit running in parallel to fuzzing — coverage zones the fuzzer cannot reach.
   - Patch-diff continuous monitoring (every new V8 commit becomes a candidate variant).

### Phase A addition for V8

In addition to (CVE history + fix lineage + boundary inventory), add a fourth Phase A input:

- **Patch-frequency heatmap**: count security-marked commits per V8 component over the last N months. Hot components are surface that recently moved AND was recently audited; cold components may be either (a) genuinely safe, (b) un-audited but in scope. Either case is informative — hot zones for variant hunts, cold zones for original audit.

### Anti-anchoring rule update

Original (from survey Section 5): <30% TurboFan/Maglev type-confusion candidates.

Updated, given 2026 reality:
- <30% TurboFan/Maglev type-confusion candidates (still valid).
- AND **at least 30% candidates targeting the "Inappropriate implementation" / logic class**, since this is the largest CVE class (33% of recent Q1 2026) and the one where analytical hunting has comparative advantage over fuzzers.

---

## Sources

- [CVE-2024-2887 Pwn2Own Wasm (ZDI)](https://www.thezdi.com/blog/2024/5/2/cve-2024-2887-a-pwn2own-winning-bug-in-google-chrome)
- [CVE-2024-5274 Parser Flaw (DARKNAVY)](https://www.darknavy.org/blog/cve_2024_5274_a_minor_flaw_in_v8_parser_leading_to_catastrophes/)
- [CVE-2023-4069 Maglev Init (GitHub Blog)](https://github.blog/security/vulnerability-research/getting-rce-in-chrome-with-incomplete-object-initialization-in-the-maglev-compiler/)
- [CVE-2021-37975 GC UAF (GitHub Blog)](https://github.blog/security/vulnerability-research/chrome-in-the-wild-bug-analysis-cve-2021-37975/)
- [CVE-2024-0517 OOB Write (Exodus Intel)](https://blog.exodusintel.com/2024/01/19/google-chrome-v8-cve-2024-0517-out-of-bounds-write-code-execution/)
- [CVE-2024-6773 Turboshaft (Bushido)](https://bushido-sec.com/index.php/2025/01/27/cve-2024-6773-type-confusion-in-v8/)
- [V8 Sandbox Escape (Theori)](https://theori.io/blog/a-deep-dive-into-v8-sandbox-escape-technique-used-in-in-the-wild-exploit)
- [V8 Sandbox Bypasses (90+)](https://github.com/xv0nfers/V8-sbx-bypass-collection)
- [Trusted Pointer Table (HITCON 2024)](https://mem2019.github.io/jekyll/update/2024/07/14/HITCON.html)
- [V8 Heap Sandbox (OffensiveCon 2024)](https://saelo.github.io/presentations/offensivecon_24_the_v8_heap_sandbox.pdf)
- [Torque Missing Check (elttam)](https://www.elttam.com/blog/simple-bugs-with-complex-exploits)
- [Don't Follow The Masses (Bluefrost)](https://labs.bluefrostsecurity.de/blog/2019/04/29/dont-follow-the-masses-bug-hunting-in-javascript-engines/)
- [Leaving the Sea of Nodes (V8 Blog)](https://v8.dev/blog/leaving-the-sea-of-nodes)
- [Maglev (V8 Blog)](https://v8.dev/blog/maglev)
- [Turbolev (Seokho)](https://blog.seokho.dev/development/2025/07/15/V8-Expanding-To-Turbolev.html)
- [Wasm Is All You Need (CODE BLUE 2024)](https://archive.codeblue.jp/2024/en/program/time-table/day2-111/)
- [2024 Zero-Day Trends (Google Cloud)](https://cloud.google.com/blog/topics/threat-intelligence/2024-zero-day-trends)
- [Wasm 3.0 Finished Proposals](https://github.com/WebAssembly/proposals/blob/main/finished-proposals.md)
- [V8 Non-Backtracking RegExp](https://v8.dev/blog/non-backtracking-regexp)
- [Project Zero 0-Day RCAs](https://googleprojectzero.github.io/0days-in-the-wild/rca.html)
- [Weaver JS-Wasm Fuzzer (2026)](https://arxiv.org/html/2603.18789v1)
- [Golden Bypass of 2024 (DARKNAVY)](https://www.darknavy.org/darknavy_insight/the_most_golden_bypass_of_2024/)
- [V8 Sandbox README](https://chromium.googlesource.com/v8/v8.git/+/refs/heads/main/src/sandbox/README.md)
