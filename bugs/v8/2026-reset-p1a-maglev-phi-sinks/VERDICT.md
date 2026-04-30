# P1-A Verdict

Status: in progress. H1-H9 initial sink shapes are refuted for VRP impact.
H7 preserves a useful diagnostic signal under `--maglev-assert-types`, but the
currently reached production sink handles the retagged Smi safely.

## H1 - String check after retagged phi

Target: `BuildCheckString` / `GetCheckType` paths.

Expected safe behavior: optimized `f(true)` returns `3`; `f(false)` deopts or
falls back and throws `TypeError`.

Verdict: REFUTED-SHAPE.

Evidence:

- `evidence/h1-asan.txt`: exit 0, no output.
- `evidence/h1-release.txt`: exit 0, no output.

Interpretation: this string-check shape deopts or preserves semantics correctly.
It does not prove all `BuildCheckString` paths are safe.

## H2 - JSReceiver check after retagged phi

Target: receiver/map check path after a numeric use creates an untagged phi.

Expected safe behavior: optimized `f(true)` returns `42`; `f(false)` deopts or
falls back and throws `TypeError`.

Verdict: REFUTED-SHAPE.

Evidence:

- `evidence/h2-asan.txt`: exit 0, no output.
- `evidence/h2-release.txt`: exit 0, no output.

Interpretation: this receiver-call shape preserves expected semantics.

## H3 - Branch ToBoolean alternative after retagged phi

Target: `BuildBranchIfToBooleanTrue` alternatives before final tagged
`BranchIfToBooleanTrue`.

Expected safe behavior: optimized `f(true)` returns `0`; `f(false)` returns `1`.

Verdict: REFUTED-SHAPE.

Evidence:

- `evidence/h3-asan.txt`: exit 0, no output.
- `evidence/h3-release.txt`: exit 0, no output.

Interpretation: this branch alternative shape preserves expected truthiness
semantics.

## H4 - FixedArray write barrier after retagged phi

Target: `StoreFixedArrayElementNoWriteBarrier` rewritten to
`StoreFixedArrayElementWithWriteBarrier` after phi retagging.

Verdict: REFUTED-IMPACT.

Evidence:

- `evidence/h4-asan.txt`: exit 0, no output.
- `evidence/h4-release.txt`: exit 0, no output.
- `evidence/h4-asan-assert-types.txt`: `CheckMaglevType failed` on Smi `7`.

Interpretation: the diagnostic type assertion catches the stale Maglev type
state, but the actual fixed-array store path is safe because
`MaglevAssembler::StoreFixedArrayElementWithWriteBarrier()` always calls
`CheckAndEmitDeferredWriteBarrier(..., kValueCanBeSmi)`.

## H5 - Map/property load consumer after retagged phi

Target: property load/map check after a numeric use creates an untagged phi.

Verdict: REFUTED-SHAPE.

Evidence:

- `evidence/h5-asan.txt`: exit 0, no output.
- `evidence/h5-release.txt`: exit 0, no output.

Observed behavior: optimized object path returns the expected property value;
HeapNumber trigger path returns `NaN`, matching ordinary JS semantics for
missing property arithmetic.

## H6 - Map/method call consumer after retagged phi

Target: method lookup/call after a numeric use creates an untagged phi.

Verdict: REFUTED-SHAPE.

Evidence:

- `evidence/h6-asan.txt`: exit 0, no output.
- `evidence/h6-release.txt`: exit 0, no output.

Observed behavior: optimized object path returns the expected method value;
HeapNumber trigger path throws `TypeError` as expected.

## H7 - Minimal FixedArray store stale type assertion

Target: minimal reproduction of stale Maglev type on a retagged phi flowing
into a fixed-array element store.

Verdict: CONFIRMED-DIAGNOSTIC / REFUTED-IMPACT.

Evidence:

- `evidence/h7-release.txt`: exit 0.
- `evidence/h7-release-assert-types.txt`: `CheckMaglevType failed`, value `7`,
  expected type `262146`, actual type `1`.
- `evidence/h7-maglev-graph.txt`: graph shows
  `Float64ToTagged[kCanonicalizeSmi]`, then
  `CheckMaglevType(HeapNumber|OtherJSReceiver|...)`, then
  `StoreFixedArrayElementWithWriteBarrier`.

Interpretation: this confirms the local stale-type primitive: retagging a
Float64 phi canonicalizes `7.0` to Smi `7` while the KNA type at the store still
excludes Smi. It is not a VRP-grade bug by itself because the reached
production store uses the fixed-array write barrier path that explicitly
accepts Smi values.

Protective path:

- `src/maglev/maglev-phi-representation-selector.cc:1337-1358` rewrites
  `StoreFixedArrayElementNoWriteBarrier` to
  `StoreFixedArrayElementWithWriteBarrier` when the value phi is retagged.
- `src/maglev/maglev-assembler.cc:698-719` emits the fixed-array write barrier
  with `kValueCanBeSmi`.

## H8 - Array store then field store stale type chain

Target: try to carry H7's stale value type into a following object field store.

Verdict: REFUTED-IMPACT.

Evidence:

- `evidence/h8-asan.txt`: exit 0, no output.
- `evidence/h8-release.txt`: exit 0, no output.
- `evidence/h8-release-assert-types.txt`: warning only, no assertion failure.

Observed behavior: object path stores/reloads the object; HeapNumber trigger
path stores/reloads Smi `7` correctly.

## H9 - `TaggedForNumberToString` after retagged phi

Target: number-to-string fast path / `TaggedForNumberToString` use hint after a
phi was used numerically, then an object reaches `String(v)`.

Verdict: REFUTED-SHAPE.

Evidence:

- `evidence/h9-asan.txt`: exit 0, no output.
- `evidence/h9-release.txt`: exit 0, no output.
- `evidence/h9-release-assert-types.txt`: warning only, no assertion failure.

Observed behavior: optimized number path returns `"12"`; trigger path calls the
object's `toString()` exactly once and returns `"object-path"`.

## H9b - H7 chained into ToBoolean

Target: `arr[0] = v; return v ? 1 : 0`.

Verdict: REFUTED-CHAIN.

Evidence:

- `poc/h9-array-store-then-toboolean-stale-type.js`.
- `evidence/h9-asan.txt`: exit 0.
- `evidence/h9-release.txt`: exit 0.
- `evidence/h9-release-assert-types.txt`: exit 0.

Interpretation: ToBoolean does not expose the H7 stale-type primitive.

## H10 - H7 chained into Reflect.getPrototypeOf

Target: `arr[0] = v; Reflect.getPrototypeOf(v)`.

Verdict: REFUTED-CHAIN for default runtime; diagnostic stale-type signal under
`--maglev-assert-types`.

Evidence:

- `evidence/h10-asan.txt`: exit 0.
- `evidence/h10-release.txt`: exit 0.
- `evidence/h10-release-assert-types.txt`: exit 133 with `CheckMaglevType
  failed`, value `7`, expected `262146`, actual `1`.

Interpretation: default runtime preserves JS semantics; assert-types still
observes the same stale `HeapNumber|OtherJSReceiver` vs Smi state before a
diagnostic check.

## H11 - H7 chained into instanceof

Target: `arr[0] = v; v instanceof C`.

Verdict: REFUTED-CHAIN for default runtime; diagnostic stale-type signal under
`--maglev-assert-types`.

Evidence:

- `evidence/h11-asan.txt`: exit 0.
- `evidence/h11-release.txt`: exit 0.
- `evidence/h11-release-assert-types.txt`: exit 133 with `CheckMaglevType
  failed`, value `7`, expected `262146`, actual `1`.

Interpretation: no release impact from this chain, but H7's stale type survives
into several diagnostic assert locations.

## H12 - Stale-type sink matrix

Target: replace one-off H8-style testing with a matrix over the same H7
stale-type producer.

Covered consumers:

- array-only return;
- field after array;
- array after field;
- two field stores;
- `Array.prototype.push`;
- property load;
- method call;
- `Reflect.getPrototypeOf`;
- `instanceof`;
- `Map.set` / `Map.get`;
- GC/churn between array store and field store.

Verdict: REFUTED-MATRIX for default runtime and ASAN; diagnostic stale-type
signal persists under `--maglev-assert-types`.

Evidence:

- `poc/h12-stale-type-sink-matrix.js`.
- `evidence/h12-release.txt`: exit 0.
- `evidence/h12-asan.txt`: exit 0.
- `evidence/h12-release-assert-types.txt`: exit 133 with the same
  `CheckMaglevType failed`, value `7`, expected `262146`, actual `1`.

Interpretation:

This is stronger than H8 because it checks multiple second-order consumers and
orders while requiring Maglev tiering for each candidate. The matrix still does
not find a production impact. The stale type is real, but all tested production
consumers either preserve semantics, force HeapNumber, or use Smi-safe paths.

## Next

Do not keep replaying one-off fixed-array and direct field-store variants. The
remaining useful escalation path is sink-first source audit: find a production
sink that consumes the H7 stale type state but does *not* have a local
`value_can_be_smi`/heap-object repair, for example a neighboring optimized
builtin, array construction path, or allocation/write-barrier decision that uses
`GetType(value)` after retagging.

Also diversify to P1-C Wasm UAF next. Staying only in Maglev is now lower
expected value until a fresh sink class is identified.

These are closer to the 2026 memory-safety class than H1-H3.
