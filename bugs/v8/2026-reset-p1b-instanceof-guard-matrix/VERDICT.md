# P1-B Verdict

Status: refuted for the covered direct/OSR `instanceof` guard shapes. Keep the
surface open only for new shapes that force a different reducer path.

## Source Invariant

`src/maglev/maglev-reducer-inl.h:1769-1864` must not partially reduce
`@@hasInstance`. The important guard is:

- non-call reducer bases return before call lowering;
- constant `@@hasInstance` must be callable;
- Turbolev/Maglev fast call path is restricted to `JSFunction`;
- prototype-chain and map dependencies must invalidate when the field or holder
  changes.

## G1 - Direct instanceof guard matrix

Verdict: REFUTED for direct optimized calls.

Coverage:

- own `@@hasInstance` returning boolean;
- own returning number / undefined for ToBoolean conversion;
- prototype-held `@@hasInstance`;
- non-callable `@@hasInstance` TypeError;
- mutating own field after warmup.

Runs:

- release default: exit 0, `evidence/g1-instanceof-guard-matrix-release.txt`
- ASAN default: exit 0, `evidence/g1-instanceof-guard-matrix-asan.txt`
- forced Maglev trace: exit 0,
  `evidence/g1-instanceof-guard-matrix-release-maglev-trace.txt`
- Turbolev trace: exit 0,
  `evidence/g1-instanceof-guard-matrix-release-turbolev-trace.txt`

Note: initial `--trace-opt` labels were misleading because Turbolev still appears
as `TURBOFAN_JS` in some trace lines. G3 adds `--print-turbolev-frontend` to
prove actual Turbolev frontend coverage.

## G2 - OSR instanceof guard matrix

Verdict: REFUTED for the OSR shapes covered.

Coverage:

- own `@@hasInstance`;
- prototype `@@hasInstance`;
- non-callable field;
- side-effectful `bar`/`try-catch` before `instanceof`;
- `%OptimizeOsr()` inside the loop.

Runs:

- release default: exit 0, `evidence/g2-instanceof-osr-matrix-release.txt`
- ASAN default: exit 0, `evidence/g2-instanceof-osr-matrix-asan.txt`
- forced Maglev trace: exit 0,
  `evidence/g2-instanceof-osr-matrix-release-maglev-trace.txt`
- Turbolev trace: exit 0,
  `evidence/g2-instanceof-osr-matrix-release-turbolev-trace.txt`

## G3 - Fix-path matrix

Verdict: REFUTED for the exact fix-path families tested.

PoC: `poc/g3-instanceof-fixpath-matrix.js`

Additional coverage beyond G1/G2:

- `rhs instanceof rhs`, matching the regression shape more closely;
- own `JSFunction` field returning boolean/object/zero;
- own `JSBoundFunction`;
- callable `Proxy(function(){})`;
- non-callable object field;
- prototype-held `JSFunction`;
- own/prototype field mutation after warmup before optimized call;
- OSR loop with `try/catch` side effect and `%OptimizeOsr()`;
- mid-loop mutation during OSR.

Runs:

- release default: exit 0, `evidence/g3-release.txt`
- ASAN default: exit 0, `evidence/g3-asan.txt`
- Turbolev frontend print: exit 0, `evidence/g3-turbolev-frontend.txt`
- Turbolev OSR/deopt trace: exit 0, `evidence/g3-turbolev-osr-deopt.txt`
- release `--turbolev --maglev-assert-types`: exit 0,
  `evidence/g3-turbolev-maglev-assert-types.txt`
- ASAN `--turbolev --maglev-assert-types`: exit 0,
  `evidence/g3-asan-turbolev-maglev-assert-types.txt`

Important observations:

- `g3-turbolev-frontend.txt` contains `V8.TFTurbolevMaglevGraphBuilder` and a
  reduced `CallKnownJSFunction(... returnsMarker ...)` for the own `JSFunction`
  case. That proves the tested fast path did enter Turbolev frontend and did
  lower `@@hasInstance` to a known JS call.
- Bound/proxy/non-callable variants remain generic `TestInstanceOf`, matching the
  source guard `if (!has_instance_field->IsJSFunction()) return {};`.
- OSR entries deopt cleanly with `exit from OSR'd inner loop`; no wrong result,
  crash, stale guard, or assertion.
- `--turboshaft-verify-load-store-taggedness` and `--verify-turboshaft` abort at
  flag processing with readonly-flag contradictions. This is infra/flag policy,
  not vulnerability signal.

## Current Decision

P1-B is not a reportable bug as tested. The fixed class appears protected for
the covered direct, OSR, mutation, callable-shape, and prototype-holder axes.
Further work on this surface should require a new sink or a different opcode
shape; otherwise move to the next P1 surface.
