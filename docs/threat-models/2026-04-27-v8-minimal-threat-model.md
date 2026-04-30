# V8 Minimal Threat Model

**Date:** 2026-04-27
**Target:** V8 14.8.178.9 (Chrome 148 stable)
**Purpose:** One-page working set for V8 hunting. Use this as the default context. The larger architectural and survey docs are reference material, not prompt material.

## Attacker model

- **Malicious JS source** reaching parser, bytecode, JIT, RegExp, and builtins.
- **Malicious Wasm bytes** reaching decoder, validator, Liftoff, Turboshaft, and GC-type machinery.
- **JS-controlled receiver and arguments** reaching V8-authored builtins and Intl/Temporal integration paths.
- **Post-primitive sandbox R/W** only for sandbox-follow-on research, not as the default starting point.

## Bug classes already accepted by V8 history (2025-2026)

- **Type confusion** in Maglev, TurboFan, and Turboshaft.
- **Inappropriate implementation** / spec or logic divergence in new engine surfaces.
- **OOB / UAF / race / integer overflow** in engine internals.
- **Wrong-code / execution integrity** where validated JS/Wasm state and executed
  target/result diverge.
- **Sandbox trusted-state invariant breaks** when in-sandbox corruptible metadata
  changes trusted tables, pointers, signatures, or code dispatch behavior.

These are the classes to prioritize first. Do not start with generic CWE hunting outside them unless a new boundary appears.

Do not treat "not a sandbox escape" as "not a bug". Sandbox escape is one
outcome. A candidate can still be reportable as type confusion, UAF/OOB, race,
wrong-code, security-relevant inappropriate implementation, or sandbox hardening
bug with concrete integrity consequence.

## Trust boundaries that matter

1. **B2 - JS source -> engine**
   Parser, interpreter, Maglev, TurboFan/Turboshaft, RegExp.
2. **B3 - Wasm bytes -> engine**
   Decoder, canonical types, Liftoff, exception handling, memory64.
3. **B4 - JS -> builtins / intrinsics**
   Temporal, Intl, Torque / CSA fast paths, receiver-type checks.
4. **B5 - sandbox / heap internals -> trusted state**
   GC barriers, bytecode trust, pointer tables, sandbox escapes.

## Priority surfaces

1. **Turboshaft reducer passes**
   Recent CVEs and public writeups show reducer-level stale-assumption bugs still land.
2. **Logic surfaces with clear oracles**
   Temporal and RegExp `/v` can be pressure-tested with spec / polyfill / test262 differential checks.
3. **Wasm 3.0 GC types**
   Newer than the better-known Wasm bug clusters and less covered by grammar-aware tooling.
4. **GC x JIT interaction**
   Rare but high-value bug class; fuzzers are weaker here than targeted stress programs.
5. **Maglev phi / representation handling**
   Fresh public lineage and still under-audited relative to TurboFan.

## Working rules

- Keep the threat model short. Add only new accepted bug classes, new trust boundaries, or a newly confirmed primitive.
- Use **one candidate per probe**.
- Use **one file:line slice** plus one violated contract sentence.
- Prefer **patch-diff, spec-diff, source audit, and differential execution** over broad prompting or writing a new fuzzer.
- Treat the detailed architectural doc as a lookup table, not a prompt payload.
- Triage every result by **impact class**: memory safety, wrong-code, security
  logic/spec, sandbox invariant, or non-security. Continue promising bounded
  primitives into adjacent sinks instead of stopping at "no escape".

## Current P1 leads

- **C13** Temporal spec-diff
- **C3** Turboshaft late load elimination
- **C16** RegExp `/v` differential
- **C7** Wasm canonical types
- **C11** GC x marker race
