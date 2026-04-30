# V8 VRP Coverage Review

**Date:** 2026-04-28
**Target:** V8 14.8.178.9 / Chrome 148 stable

## Executive read

Yes: we need to review what we have done. Current work has depth in a few
branches, but not balanced VRP coverage.

Main issue:

- We spent heavy effort on sandbox-follow-on primitives, especially C21.
- We did some JIT and Wasm work, but mostly variant/refutation.
- We under-tested 2026's largest VRP class: security-relevant
  "Inappropriate implementation" / logic bugs.
- Several original P1/P2 surfaces remain unstarted or only mechanically
  audited.

Correction:

- Keep sandbox escape and sandbox hardening in scope.
- Add equal weight to memory safety, wrong-code, logic/spec, race, side-channel,
  object corruption, and JIT/Wasm validator bugs.
- Re-triage every existing candidate by impact class and not only by escape.

## What we actually covered

| Surface / candidate | Status | Real coverage | VRP takeaway |
|---|---|---|---|
| C3 Turboshaft late load elimination | Round closed, no confirmed bug | Many JS/Wasm raw-pointer and stackcheck variants; H8 inconclusive trace harness | Good reducer work, but not enough for all Turboshaft 2025/2026 patterns |
| C4 Turboshaft store-store | Open, no confirmed bug | JS-expressible GC-observable stores, merge-pair, alias, partial-overlap | Good refutations; needs patch-diff/unit-level variant if continued |
| C6 ObjectIs switch audit | Refuted | Mechanical enum/switch completeness only | Too narrow; does not cover real Turboshaft wrong-code/type flow |
| C7 Wasm canonical types | Experimental crash + many refutations | Good canonical identity/subtyping checks; confirmed crash only behind experimental shared/custom descriptors | Experimental crash not VRP reward as-is; shipped Wasm GC needs more normal-input variants |
| C11 GC marker race | Open, no confirmed bug | JS-accessible shared heap and marking stress H1-H7 | Good first pass; race CVEs need patch-diff and narrower C++/API sinks |
| C13 Temporal | Expanded, no new VRP-grade bug | H1 duplicate `u-ca` downgraded after test262 oracle; H5-H12 Intl/calendar/annotation probes; H12 known era/default-format failure | Logic class still worth hunting, but old duplicate-calendar signal is not a primitive |
| C16/C17 RegExp `/v` | Refuted broader slice | Astral/surrogate/property alias probes + mixed string/range set ops + property-of-strings/JIT-vs-interpreter; 114 generated UnicodeSets test262 tests run directly | Generated set algebra now covered; only failure was known Unicode 17 data mismatch |
| C19 JSPI suspender | Refuted fixed regression | Exact upstream and nested resume variants | Fine to park unless new stack retirement path appears |
| C20 Wasm shared memory grow race | Open, low yield | Upstream regression + buffer/grow/worker/atomic siblings | Park unless new sink bypasses stack guard refresh |
| C21 sandbox sink audit | Strong bounded primitives | H27 signature-confused execution; H33/H34 visible/hidden dispatch divergence | Best current report-candidate as sandbox invariant / wrong-code, but still needs natural corruption or stronger consequence |
| C1 Maglev phi untagging | Expanded, no confirmed bug | H1-H3 side-effect number phi, try/catch phi, peeled-backedge HeapNumber; H4-H6 OSR non-Smi phi into property store, element store, ToObject/for-in | Do not close C1; move next to ToBoolean/CheckMaps/CheckMaglevType/nested-loop variants |

## Original matrix gaps

The original Phase D matrix had 18 candidates. Actual gap:

| Candidate group | Coverage | Gap |
|---|---|---|
| C1/C2 Maglev phi untagging | Started C1 H1-H6 | Arithmetic/deopt, OSR store, element, and ToObject sinks refuted; ToBoolean/CheckMaps/CheckMaglevType/nested-loop variants remain |
| C3/C4 Turboshaft reducers | Started | Needs impact-first revisit: JIT wrong-code, not just stale pointer/GC |
| C5 Turboshaft machine lowering | Not really started | C6 enum audit is not enough; need executable wrong-code probes |
| C6 ObjectIs switch audit | Refuted mechanically | Does not close S3 |
| C7/C8 Wasm canonical types | Started | C8 import/link/signature variants need broader normal-input coverage |
| C9/C10 Liftoff arm64 | Not started | Large gap; Mac arm64 and Linux x64 comparison available |
| C11/C12 GC marker race | Started C11 only | C12 minor/major and API/native publication paths under-covered |
| C13/C14/C15 Temporal | C13 deeper H1-H12 | Annotation/offset/era/duration probes mostly refuted; C14/C15 Intl/state/non-ISO variants still open |
| C16/C17 RegExp `/v` | C16 H1-H7 + C17 generated oracle refuted | Needs regexp JIT stress/backtracking fallback; C17 surrogate fallback still not fully audited |
| C18 Bytecode trust | Expanded | H1/H2 invalid `ContextSlot`; H6/H8/H9/H11/H12 feedback OOB/release crash; H17 wrong value; H18 `ScopeInfo` exposure; H19-H36 store/propagate exposed internal value into JS containers, survive GC, and hit release JSON/IC/array/coercion fatal checks; H37-H39 reproduce core bad value-flow with valid bytecode plus sandbox `FeedbackVector` corruption; H40-H47 produce clean wrong-global/cross-realm read via valid `PropertyCell` aliasing |

## Impact-class coverage

| Impact class | Current coverage | Problem |
|---|---|---|
| Sandbox escape / trusted-state | Deep in C21 | Good depth, but over-weighted |
| Memory safety | Some C3/C4/C7/C11/C20 | Mostly refuted variants, not broad enough |
| Wrong-code / execution integrity | C21 H27/H33/H34; limited JIT differentials | Need Maglev/Turboshaft/TurboFan interpreter-vs-optimized probes |
| Security logic / inappropriate implementation | C13 expanded and small C16 slice | Still under-weighted vs 2026 CVEs; need better oracle from test262/status + patch-diff, not ad hoc spec memory |
| Race | C11/C20 | Good JS stress, weak patch-diff / native sink analysis |
| Side-channel / info leak | Not covered | CVE-2025-10890 class absent |
| Object corruption | Only indirectly C21 | CVE-2025-0611 / CVE-2026-5279 class absent |
| Bytecode trust | Started | Sink exists; reachability/chain not solved |

## Findings and candidates to preserve

### Preserve as report candidates / primitives

- C21 H34:
  - `victim.get(1) === visible`;
  - `visible(5)=117`;
  - same table/index `call_indirect(1,5)=37`;
  - no `--experimental`;
  - dcheck invariant: `src/wasm/wasm-objects.cc:291`
    `old_size == dispatch_table->length()`.
  - Class: wrong-code / sandbox invariant.
- C21 H27:
  - `WasmFuncRef.trusted_internal` transplant executes wrong body under wrong
    signature.
  - Class: bounded Wasm signature-confused execution.
- C13 H12 Intl Temporal era/default-format:
  - confirmed local behavior: era-only options return only era for Temporal;
  - already tracked in local test262 status as `b/463427743`;
  - useful sink class, not new report candidate as-is.
- C7 H8/H9:
  - experimental shared/custom descriptor crash;
  - upstream correctness/DoS, likely not Chrome VRP reward because experimental.
- C18 H1/H2:
  - `BytecodeVerifier::VerifyFull()` accepts `ContextSlot=255`;
  - `%InstallBytecode()` publishes/installs the malformed bytecode;
  - execution hits Torque unreachable in release/ASAN/dcheck;
  - Linux `--sandbox-testing` classifies it as harmless `SIGTRAP`, not a
    sandbox violation;
  - preserve as bytecode trust sink, not report candidate yet.
- C18 H6:
  - warmed `CallProperty2` bytecode with `FBV[2] -> FBV[255]`;
  - `VerifyFull()` accepts the invalid feedback slot;
  - release crashes with `BUS_ADRALN`;
  - ASAN/dcheck reports `IsOffsetInBounds(offset, LoadFeedbackVectorLength(feedback_vector), FeedbackVector::kHeaderSize)`;
  - Linux sandbox-testing reports safe-region memory access, so not escape yet;
  - strongest C18 sink so far.
- C18 H8/H9:
  - warmed named/keyed stores with `FBV[0] -> FBV[255]`;
  - release interpreter-only crashes with `BUS_ADRALN`;
  - ASAN/dcheck routes through `Runtime_StoreIC_Miss` and
    `Runtime_KeyedStoreIC_Miss`;
  - Linux sandbox-testing reports safe-region memory access;
  - confirms the issue is a feedback operand class, including write-side ICs.
- C18 H11/H12:
  - warmed named/keyed loads with `FBV[0] -> FBV[255]`;
  - release interpreter-only and default verifier runs crash with `BUS_ADRALN`;
  - Linux sandbox-testing reports safe-region memory access;
  - confirms read-side ICs are affected too.
- C18 H17:
  - warmed global load with `LdaGlobal [name], FBV[255]`;
  - release/default verifier returns `7` instead of global value `13`;
  - Linux sandbox-testing also returns Smi `7`;
  - ASAN/dcheck reports `IsWeakOrCleared(maybe_weak_ref)` in
    `LoadGlobalIC_TryPropertyCellCase`;
  - best current C18 wrong-code/integrity primitive, still via
    `%InstallBytecode()`.
- C18 H18:
  - matrix for `LdaGlobal FBV[n]`;
  - `slot=4/5/255` stores `ScopeInfo FUNCTION_SCOPE` or
    `ScopeInfo SCRIPT_SCOPE` into JS local `r` before abort;
  - Linux sandbox-testing slot 4 reproduces internal object in JS local and
    exits 0;
  - strongest C18 direction: shape global-load feedback OOB from wrong value
    into internal object exposure/corruption.
- C18 H19/H20:
  - H19 stores exposed `ScopeInfo`-class value into object property and array
    element, reloads both, and survives two GCs in release/ASAN/Linux sandbox;
  - H20 release completes, but ASAN/dcheck fails in `StoreIC::Store` with
    `TrustedCast<JSAny>`;
  - this is now a JSAny boundary violation primitive, still missing natural
    bytecode reachability.
- C18 H21-H25:
  - H21 property reads and strict equality preserve the poisoned internal value;
  - H23 array iteration/spread/includes also carry it without immediate fatal;
  - H24 optimized caller forwarding survives in release;
  - H22 `JSON.stringify()` over a poisoned container hits release
    `Check failed: IsJSReceiver(*object)`;
  - H25 repeated poisoned containers under GC/IC stress hit release
    `unreachable code` in `FeedbackNexus::GetFirstMap()` /
    `Runtime_LoadGlobalIC_Miss`;
  - Linux sandbox-testing classifies H22/H25 as harmless termination, so still
    not sandbox escape.
- C18 H26-H36:
  - object copy/introspection, `Map`, `Set`, delete/overwrite/freeze/seal,
    `Object.prototype.toString`, and `Boolean()` tolerate the poisoned value;
  - `Array.prototype.join`, `typeof`, and `String()` fatal in release;
  - ASAN/dcheck maps the failures to Torque cast checks and
    `TrustedCast<JSAny>`;
  - Linux sandbox-testing exits 0 for fatal consumers, so impact remains bounded
    without natural reachability or sandbox-boundary crossing.
- C18 H37-H39:
  - no `%InstallBytecode()` and no malformed bytecode;
  - valid `LdaGlobal FBV[0]` plus sandbox corruption copying
    `FeedbackVector[4] -> FeedbackVector[0]`;
  - result: `same-global false`, then release fatal
    `Check failed: IsPropertyCell(*feedback_value)`;
  - dcheck also logs `TrustedCast<JSAny>` / Torque array-cast failures;
  - source-slot matrix shows object/string wrong values and inside-sandbox
    memory access variants;
  - stronger sandbox post-corruption primitive, still not escape because
    sandbox-testing terminates harmlessly.
- C18 H40-H47:
  - valid bytecode and valid `PropertyCell` values;
  - copying `g`'s global-load property cell into `f`'s feedback slot makes
    unchanged `f(){return A}` return `B`;
  - alias is live: writes to `A` do not affect `f`, writes to `B` do;
  - optimized caller preserves the corrupted behavior;
  - dcheck does not flag H40/H42/H43;
  - StoreGlobal redirection matrix did not redirect writes;
  - SFI/metadata mismatch hits compiler invariant checks before miscompile.
  - same alias works across d8 realms, including plain `Realm.create()`;
  - still sandbox-corruption-model only, no sandbox violation.
- C18 reachability audit:
  - normal bytecode generation verifies before publication;
  - debug bytecode copies existing verified bytecode and patches opcodes only;
  - serializer swaps debug/original bytecode but does not synthesize operands;
  - embedded feedback mutates verified bytecode post-publication, but only via
    bounded OR updates;
  - no natural arbitrary `FeedbackSlot` writer or `FeedbackVector` slot poisoning
    source found yet.

### Do not over-count as closed

- C16/C17 RegExp `/v`: H1-H7 and C17 generated test262 run cover broad set algebra; remaining work is JIT/backtracking/fallback and non-generated surrogate edges.
- C13 Temporal: old duplicate-calendar annotation signal is downgraded; H12 is known-to-Google; variants outside test262 status remain open.
- C6/S3: mechanical switch audit does not close machine lowering.
- C11: JS stress did not close race class.
- C3: H8 trace harness remains useful; C3 not globally closed.

## Re-open list

Priority order for next VRP-balanced work:

1. **Maglev phi / representation wrong-code (C1/C2)**
   - Impact class: wrong-code / type confusion.
   - Why: public 2026 lineage; C1 H1-H3 only covered arithmetic/deopt shapes.
   - Test style: interpreter vs Maglev vs TurboFan output, phis feeding stores,
     write barriers, `ToBoolean`, `CheckMaps`, `CheckMaglevType`, OSR values.

2. **Temporal deeper logic/security (C13/C14/C15)**
   - Impact class: inappropriate implementation.
   - Why: 2026 CVE distribution says this class is huge.
   - Test style: local test262/status first, then polyfill differential for
     ZonedDateTime, calendars, offsets, era/year, Duration rounding, Intl
     integration.

3. **RegExp `/v` broader differential (C16/C17)**
   - Impact class: inappropriate implementation / parser-matcher mismatch.
   - Why: H1-H7 refuted local set algebra; external oracle still missing.
   - Test style: test262 differential, Unicode-version boundary cases, large
     string-property sets, compiled-regexp stress.

4. **Turboshaft/Machine lowering executable probes (C5/S3)**
   - Impact class: wrong-code / type confusion.
   - Why: C6 enum audit was too narrow.
   - Test style: construct `ObjectIsOp` and representation assumptions through
     JS/Wasm, compare interpreter vs optimized.

5. **Liftoff arm64 (C9/C10)**
   - Impact class: memory safety / wrong-code.
   - Why: completely untouched; local host is arm64.
   - Test style: same Wasm corpus on Mac arm64 and Linux x64, Liftoff vs
     optimized, memory64/GC/ref/exception opcodes.

6. **Bytecode trust (C18)**
   - Impact class: sandbox invariant / interpreter trust.
   - Why: `ContextSlot` verifier gap confirmed; in-sandbox bytecode is trusted
     by interpreter.
   - Test style: extend from H1/H2 into handler table, native-context indexes,
     feedback slots, and post-`MarkVerified()` mutation; look for release
     memory corruption or sandbox violation, not only trap.

7. **Patch-diff inappropriate implementation clusters**
   - Impact class: logic/security.
   - Why: Oct 28 2025 and Apr 7 2026 V8 batches likely contain variant
     fingerprints.
   - Test style: map fixing commits to files, then audit untouched siblings.

8. **Object corruption / side-channel**
   - Impact class: object corruption / info leak.
   - Why: present in 2025-2026 CVEs, absent in our matrix.
   - Test style: patch-diff CVE-2026-5279 / CVE-2025-10890 if public fixes can
     be located; derive sibling sinks.

## Required process change

Every future candidate gets these fields before probing:

```text
Impact class:
Reachability:
Feature flags:
Security consequence:
Oracle:
Stop condition:
Escalation if bounded:
```

Stop condition cannot be "no sandbox escape" unless the candidate's only
possible consequence was sandbox escape.

## Next 10-hypothesis batch

Balanced batch:

1. Maglev phi Smi/HeapNumber side-effect conversion.
2. Maglev try/catch phi representation.
3. Temporal Intl era/default-format sibling variants outside `b/463427743`.
4. Temporal non-ISO calendar alias/state-pollution variants in Intl paths.
5. RegExp `/v` nested string-set subtraction with `/i`.
6. RegExp `/v` property escape version-boundary differential.
7. Turboshaft ObjectIs executable wrong-code probe.
8. Liftoff arm64 Wasm GC array/struct edge corpus.
9. BytecodeArray try-handler mutation under sandbox testing.
10. C21 H34 escalation: implicit_arg/signature/wrapper path from visible/hidden
    table divergence.

This batch preserves sandbox escape pursuit but restores VRP class diversity.
