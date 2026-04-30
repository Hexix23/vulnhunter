# V8 VRP Impact-First Hunt Model

**Date:** 2026-04-28
**Target:** V8 14.8.178.9 / Chrome 148 stable
**Purpose:** Stop over-anchoring on sandbox escapes. Use this as the triage lens
for every new V8 hypothesis.

## Core correction

Do not classify a candidate as "dead" because it is not a sandbox escape.
Sandbox escape is one high-value outcome, but Chrome VRP-grade V8 bugs also
include wrong-code, type confusion, UAF, OOB, race, integer overflow, object
corruption, side-channel, and security-relevant inappropriate implementation.

The 2025-2026 local CVE recon shows the reason:

- Type confusion: 34% overall.
- Inappropriate implementation: 22% overall, 38% in 2026.
- OOB / UAF / integer overflow / object corruption / race still recur.

So every hunt slice must ask: "what security consequence can this produce?",
not only "does this cross the sandbox?"

## Reportable impact classes

### R1 - Memory safety

Reportable if normal JS/Wasm input produces:

- type confusion;
- UAF / stale pointer use;
- OOB read/write;
- object corruption;
- integer overflow with memory/object consequence;
- race causing missed barrier, stale code/data, or use after collection.

Evidence needed:

- minimized PoC;
- release and checking/ASan comparison where possible;
- stack trace or observable wrong memory/object behavior;
- exact source invariant violated.

### R2 - Wrong-code / execution integrity

Reportable if V8 executes code that does not match validated program state:

- `table.get(i)` / visible state disagrees with dispatched target;
- JIT optimized result differs from interpreter for same input;
- Wasm signature/canonical type check accepts one shape but executes another;
- deopt/tier-up preserves stale assumptions.

Evidence needed:

- interpreter vs optimized, `call_ref` vs `call_indirect`, or debug vs release
  differential;
- output values showing integrity impact, not just crash;
- source line where invariant is debug-only or absent in release.

### R3 - Security-relevant inappropriate implementation

Reportable if spec/logic divergence affects security behavior:

- origin/security boundary, capability, permission, policy, crypto, side-channel,
  data confidentiality/integrity, or renderer safety;
- parser accepts forbidden syntax that later reaches a privileged semantic path;
- Temporal/Intl/RegExp/Wasm validator diverges from spec and creates bypass or
  exploitable state.

Non-reportable or low-value if:

- pure formatting/spec mismatch with no security consequence;
- behavior only behind V8 `--experimental` flags;
- unreachable from web content or shipped APIs.

Evidence needed:

- spec citation or reference implementation/test262 differential;
- Chrome/V8 command line without unnecessary experimental flags;
- concrete user harm or engine security consequence.

### R4 - Sandbox invariant violation

Reportable or report-candidate if sandbox attacker model produces:

- out-of-sandbox read/write;
- trusted table OOB;
- code pointer / dispatch pointer / signature corruption;
- trusted state and in-sandbox visible state divergence that changes execution;
- missing release `SBXCHECK` where dcheck documents trusted invariant.

Evidence needed:

- memory-corruption API PoC is acceptable for modeling in-sandbox attacker, but
  final triage should still show a boundary violation or concrete integrity
  consequence;
- no reliance on V8 `--experimental` unless the bug is not specific to that
  configuration;
- exact trusted field, consumer, and release guard gap.

## Triage ladder

Use this order for every hypothesis:

1. **Reachability**: normal JS/Wasm/RegExp/Temporal path, or sandbox attacker
   model only?
2. **Invariant**: what does source claim? Cite `file:line`.
3. **Consequence**: R1/R2/R3/R4. If none, do not spend more time.
4. **Differential**: release vs dcheck/ASan, interpreter vs optimized, visible
   state vs hidden state, spec/polyfill/test262 vs V8.
5. **Escalation**: if consequence is bounded, look for adjacent sink that turns
   it into memory safety or security logic impact.

## Candidate mix for next rounds

Every 10 new V8 hypotheses should include at least:

- 3 logic/spec/inappropriate implementation candidates;
- 2 JIT wrong-code/type-confusion candidates;
- 2 Wasm validation/dispatch/canonical type candidates;
- 1 GC/race/barrier candidate;
- 1 sandbox trusted-state candidate;
- 1 under-explored surface candidate (bytecode trust, RegExp `/v`, Temporal,
  Wasm GC, Turbolev).

If all candidates become sandbox escapes or all become JIT type confusion, the
round is anchored and must be rebalanced.

## C21 reclassification

C21 is not only a sandbox-escape branch.

Confirmed impact so far:

- H27: bounded Wasm signature-confused execution.
- H33/H34: same table/index has visible entry one target, trusted dispatch
  another target.

Current class:

- R2 wrong-code / execution integrity under R4 sandbox attacker model.

Current blocker:

- field corruption still uses memory-corruption API;
- no normal-input corruption source or out-of-sandbox read/write yet.

Useful next work:

- minimize H34 as sandbox hardening report candidate;
- search normal-input corruption sources for `WasmTableObject.raw_type`,
  `trusted_dispatch_table`, or `WasmFuncRef.trusted_internal`;
- test if visible/hidden dispatch divergence can affect signature,
  implicit-arg, wrapper tier-up, or trusted table bounds.
