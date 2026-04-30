# P1-B Walkthrough

## Why This Surface

2026 V8 CVEs skew toward JIT type confusion and "inappropriate
implementation". The local patch `40999af682a [M148] [turbolev] Fix wrong guard
in TryBuildFastInstanceOf` is a good variant seed because it sits at a reducer
trust boundary: bytecode feedback says `instanceof` has a stable RHS, then
Maglev/Turbolev may replace generic semantics with checks and a lowered
`@@hasInstance` call.

## Source Read

The relevant bytecode visitor is `VisitTestInstanceOf` in
`src/maglev/maglev-graph-builder.cc`, which calls
`TryBuildFastInstanceOfWithFeedback`.

The reducer in `src/maglev/maglev-reducer-inl.h` has three important exits:

- no fast path when feedback is insufficient;
- ordinary `instanceof` only when no `@@hasInstance` is found and RHS is
  callable;
- custom `@@hasInstance` only when the field is a callable `JSFunction` and the
  reducer base can build the call.

That last condition is the patch fingerprint. A bypass would likely show up as
wrong TypeError behavior, stale field/prototype dependency, or a lowered call for
a non-`JSFunction` callable shape.

## Probe Strategy

G1 tested direct optimized calls over common `@@hasInstance` values.

G2 tested OSR loops with side effects before `instanceof`, matching the shape of
the regression test.

G3 tightened the probe because G1/G2 were still too shallow:

- each case gets a separate closure, avoiding mixed feedback;
- `rhs instanceof rhs` is used to match the regression more closely;
- `--print-turbolev-frontend` is used as the path oracle;
- callable `JSFunction`, bound, proxy, non-callable, proto holder, and mutation
  cases are all covered;
- release, ASAN, Turbolev frontend, OSR/deopt, and assert-type runs are recorded.

## Result

No reportable bug was reproduced. The own `JSFunction` case reduces to
`CallKnownJSFunction`, while bound/proxy/non-callable cases remain generic
`TestInstanceOf`. Own/prototype mutation deoptimizes or observes the updated
field correctly. OSR loops enter optimized code and deopt cleanly.

The surface should not be closed globally, but this particular patch-derived
hypothesis is refuted unless a new shape forces different feedback or a different
lowering path.
