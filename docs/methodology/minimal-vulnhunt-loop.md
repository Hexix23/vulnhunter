# Minimal Vuln Hunt Loop

This is the short operational form of `vulnhunt-methodology.md`. Use it when
the longer methodology starts turning into documentation instead of hunting.

## Principle - threat model is the scaffold

The only required scaffolding before code audit is an editable threat model.
Do not start with agents, skills, orchestration, or a mega-prompt.

Workflow:

1. Build system context from prior CVEs and accepted bug classes.
2. Compress that context into a small threat model.
3. Feed that model to Codex for code research.
4. Ask for invariants, fix-bypass candidates, and source-to-sink probes.
5. Keep extending the threat model only with new bug classes, boundaries,
   sinks, and confirmed primitives learned during the audit.

Threat modeling is the compression layer. It improves signal without bloating
the context window.

## Rule 0 - no fake scaffold

Do not prove a bug in a toy scaffold that bypasses the target's normal guards.
Use the canonical runtime or canonical project scaffold.

For V8 this means:

- run the shipped engine surface: `d8` release plus ASAN/DCHECK when useful;
- avoid extra experimental flags unless the bug class itself is experimental;
- do not use `--sandbox-testing` or memory-corruption APIs for normal JS/Wasm
  VRP bugs;
- if using sandbox attacker model, label it `SANDBOX_INVARIANT` from the start.

For Angular this means:

- first prove the behavior against Angular framework code or an Angular-owned
  test target;
- then prove reachability in a canonical Angular app/runtime for that surface
  (`@angular/ssr`, browser app, hydration, service worker, or compiler output);
- do not create a deliberately vulnerable app as the only evidence;
- label the setup as `default`, `common-config`, `chain-required`, `legacy`,
  or `misconfiguration` before discussing severity;
- do not move a finding toward report text until the default/common reachability
  and attacker-victim model are clear.

## One Candidate Loop

Every candidate must fit this shape before probing:

```text
Target:
Phase: CVE-derived | Expansion
Prior CVE class:
Advisory/fix source:
Fix diff files:
Invariant:
Entry point:
Trust boundary:
High-risk operation:
Attacker model:
Sink:
Attacker-controlled value:
Expected violation:
Canonical runtime:
Oracle:
Reportability bar:
Stop condition:
```

If any field is vague, do not write a PoC yet. Read source or patch-diff until
the field is concrete.

For Phase 1, `Prior CVE class`, `Advisory/fix source`, `Fix diff files`, and
`Invariant` are mandatory. For Phase 2, `Entry point`, `Trust boundary`,
`High-risk operation`, and `Attacker model` are mandatory.

## Phase Checklist

1. Pick target project and exact version.
2. Research prior disclosed CVEs.
3. Build a CVE-derived threat model.
4. Feed only the compact threat model into the hunt loop.
5. Phase 1 - known bug classes:
   - extract invariants from past vulnerabilities;
   - examine fix commits for bypasses and sibling sinks;
   - hunt variants in known categories.
6. Phase 2 - expand attack surface:
   - entry points;
   - trust boundaries;
   - high-risk operations;
   - attacker model.
7. Update the threat model only when a new class, boundary, sink, or primitive
   is learned.
8. Prioritize by impact and reachability.
9. Write the smallest canonical PoC.
10. Reproduce and classify from evidence, not intuition.

## Phase 1 - known bug classes first

Use the project's own accepted CVEs as the strongest prior. If the target has
accepted type confusion, OOB, UAF, race, memory corruption, sandbox invariant,
or inappropriate implementation reports, those classes are valid hunt classes.

For every prior CVE:

```text
CVE:
Bug class:
Affected component:
Attacker input:
Broken invariant:
Security sink:
Fix commit:
Fix shape: targeted | class-wide | unknown
Sibling sinks:
Bypass hypotheses:
```

Do not ask "audit this codebase." Ask "this project has accepted bug class C at
sink S because invariant I failed; find sibling code paths where I can still be
made false."

## Phase 2 - expansion after CVE-class pass

After known classes have been explored, expand beyond the CVE-shaped surface:

```text
Entry points: HTTP routes, RPC handlers, message consumers, CLI entrypoints,
scheduled jobs, parsers, bytecode/Wasm/RegExp/Temporal inputs.

Trust boundaries: browser to server, service to service, plugin to host,
sandbox to privileged, JS source to JIT/runtime, Wasm bytes to engine internals.

High-risk operations: parsing, deserialization, templating, native bindings,
authz checks, compiler lowering, GC/write barriers, pointer/dispatch tables.

Attacker model: remote unauthenticated, remote low-privileged authenticated,
cross-tenant, malicious package/config author, malicious JS/Wasm/RegExp input,
or in-sandbox memory-corruption attacker.
```

Phase 2 findings still need the same invariant, sink, canonical runtime, and
evidence gate. Expansion is not permission to become vague.

## Phase Gate

Do not start Phase 2 for a target until Phase 1 has a compact status table:

```text
Advisory:
Fix:
Changed files:
Bug class:
Broken invariant:
Patched guard:
Sibling sinks:
Bypass hypotheses:
Status: not-started | probing | refuted | primitive | confirmed
```

Phase 2 candidates are allowed before Phase 1 is complete only when they are
explicitly marked as expansion primitives and do not displace the CVE-derived
queue.

## Evidence Gate

A candidate is not confirmed until it has:

- source cite for the violated invariant;
- source-to-sink reachability;
- canonical runtime command;
- saved evidence output;
- clear oracle: crash, ASAN/DCHECK, interpreter-vs-optimized mismatch,
  spec/test262/polyfill differential, or visible-vs-hidden trusted-state
  divergence.

## Stop / Continue

Stop a branch when:

- the guard rejects before the sink;
- the sink is unreachable through canonical runtime;
- the only signal is a known test failure or purely non-security mismatch;
- three variants close on the same protective code path.

Continue a branch when:

- a wrong value reaches a new sink;
- a debug-only invariant guards release execution;
- a fix was targeted rather than class-wide;
- a sibling entry point reaches the same sink with different validation.
