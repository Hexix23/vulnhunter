# P1-B Instanceof Guard Lowering Matrix

Date: 2026-04-29
Threat model: `docs/threat-models/2026-04-28-v8-2026-cve-threat-model-reset.md`

Prior CVE class: 2026 Type Confusion in Turbofan/Turbolev and local fix signal
`40999af682a [M148] [turbolev] Fix wrong guard in TryBuildFastInstanceOf`.

## Seed Invariant

`TryBuildFastInstanceOf` must not emit guards/checks for a speculative
`Symbol.hasInstance` fast path unless the reducer can fully lower the call and
all dynamic guards required by generic `instanceof` are present.

Bad class:

- emit `BuildCheckValueByReference` / `BuildCheckMaps`;
- then fail to lower call or use wrong callable shape;
- leave graph with incomplete semantic guard;
- OSR/deopt observes wrong value, wrong exception, or type confusion.

## Source Anchors

- `src/maglev/maglev-reducer-inl.h:1750-1864`
- `src/maglev/maglev-graph-builder.cc:13941-13955`
- `test/mjsunit/turbolev/regress-499934837.js`

## Matrix Axes

| Axis | Values |
|---|---|
| `Symbol.hasInstance` location | own property, prototype property |
| callable shape | JS function, bound function, revoked proxy callable, non-callable object |
| return value | boolean, object with `valueOf`, number, undefined |
| tier trigger | direct optimize, OSR loop |
| side effects | mutate `Symbol.hasInstance`, mutate prototype chain, throw/catch before instance check |
| operand stability | constant callable, callable returned from side-effectful function |
| oracle | interpreter vs Maglev/Turbolev result, TypeError presence, deopt/crash |

## Required Testing Standard

No single PoC closes the hypothesis. Each matrix script must:

- require optimized tier status where applicable;
- include interpreter warmup expected behavior;
- run default release;
- run ASAN;
- run diagnostic/stress flags where relevant (`--trace-deopt`, `--stress-maglev`
  or OSR path);
- document whether the shape actually hit the target path.

## Probe Log

### G1/G2

Initial direct and OSR matrices covered normal `instanceof` feedback, but the
trace signal was ambiguous: `--trace-opt` can still print `TURBOFAN_JS` while
`--turbolev` is enabled. These runs are useful for behavior, not sufficient for
Turbolev-path proof.

### G3

`poc/g3-instanceof-fixpath-matrix.js` adds monomorphic per-case functions and
uses `--print-turbolev-frontend` as the path oracle. This confirmed actual
Turbolev frontend entry and a reduced `CallKnownJSFunction` for the
`JSFunction @@hasInstance` case, while bound/proxy/non-callable cases stayed on
generic `TestInstanceOf` as intended by the fix.

Covered sink families:

- known `JSFunction` `@@hasInstance` lowered to call + ToBoolean continuation;
- generic fallback for `JSBoundFunction`, callable proxy, and non-callable field;
- dependency invalidation after own/prototype field mutation;
- OSR loop entry/deopt around `try/catch` side effect and `%OptimizeOsr()`.

No wrong-result, crash, or diagnostic assertion was observed.
