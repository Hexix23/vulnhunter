# C1 Maglev Phi Verdict

Date: 2026-04-28

Target:

- `/Users/carlosgomez/v8-engagement/v8/v8/src/maglev/maglev-phi-representation-selector.cc`
- Impact searched: wrong-code / type confusion from unsafe phi untagging.

## Summary

H1-H6 are `REFUTED` for current shapes.

Important: this does not close the Maglev phi surface. It only says these three
side-effect / catch / peeled-backedge / OSR sink shapes deopt or preserve result
correctly when the phi is optimized in Maglev.

## Evidence

Flags:

```sh
/Users/carlosgomez/v8-engagement/v8/v8/out/release/d8 \
  --allow-natives-syntax --maglev --maglev-as-top-tier --maglev-untagged-phis
```

Speculative hoist variant:

```sh
/Users/carlosgomez/v8-engagement/v8/v8/out/release/d8 \
  --allow-natives-syntax --maglev --maglev-as-top-tier --maglev-untagged-phis \
  --maglev-speculative-hoist-phi-untagging
```

ASAN/DCHECK:

```sh
/Users/carlosgomez/v8-engagement/v8/v8/out/asan/d8 \
  --allow-natives-syntax --maglev --maglev-as-top-tier --maglev-untagged-phis
```

Files:

- `evidence/h1-release.txt`
- `evidence/h1-release-spec-hoist.txt`
- `evidence/h1-asan.txt`
- `evidence/h2-release.txt`
- `evidence/h2-release-spec-hoist.txt`
- `evidence/h2-asan.txt`
- `evidence/h3-release.txt`
- `evidence/h3-release-spec-hoist.txt`
- `evidence/h3-asan.txt`
- `evidence/h4-release.txt`
- `evidence/h4-asan.txt`
- `evidence/h5-release.txt`
- `evidence/h5-asan.txt`
- `evidence/h6-release.txt`
- `evidence/h6-asan.txt`

All release and ASAN runs returned `OK`. Each run confirmed Maglev before the
trigger:

```text
maglev_after_warm=true
maglev_after_got=false
```

So the optimized function entered Maglev, then trigger path deoptimized cleanly.

## Hypotheses

### H1 side-effecting `valueOf()` feeds number phi

Result: `REFUTED`.

Observed:

```text
base=3.5
warm=4
got=3.5
maglev_after_warm=true
maglev_after_got=false
OK
```

Interpretation: Maglev entered optimized code for trained Smi path; HeapNumber
path deoptimized and matched interpreter.

### H2 try/catch path assigns HeapNumber into trained phi

Result: `REFUTED`.

Observed:

```text
base=3.5
warm=4
got=3.5
maglev_after_warm=true
maglev_after_got=false
OK
```

Interpretation: exception/catch phi shape did not preserve unsafe Int32/Float64
assumption past side-effect path.

### H3 peeled loop backedge changes Int32-like phi to HeapNumber

Result: `REFUTED`.

Observed:

```text
base=2.5
warm=8
got=2.5
maglev_after_warm=true
maglev_after_got=false
OK
```

Interpretation: peeled-backedge speculation deoptimized and preserved semantics.

### H4 OSR non-Smi phi stored into object property

Result: `REFUTED`.

Observed:

```text
base=1308622848
warm=0
got=1308622848
status=65
OK
```

Interpretation: an OSR value phi carrying a non-Smi HeapNumber-sized integer
through object property storage preserved interpreter semantics in Release and
ASAN/DCHECK.

### H5 OSR non-Smi phi stored into fixed-array element

Result: `REFUTED`.

Observed:

```text
base=1308622848
warm=0
got=1308622848
status=65
OK
```

Interpretation: the same OSR value phi through element storage/reload preserved
semantics in Release and ASAN/DCHECK.

### H6 OSR HeapNumber-like value feeding ToObject / for-in

Result: `REFUTED`.

Observed:

```text
base=0
got=0
status=65
OK
```

Interpretation: the local `regress-329476993`-style ToObject sink did not
reproduce a crash or wrong-code in this revision.

## Protective Code Seen

Relevant source:

- `maglev-phi-representation-selector.cc:218-226` ignores peeled backedge only
  in narrow loop-with-peeled-iteration case.
- `maglev-phi-representation-selector.cc:266-275` speculative hoist requires a
  loop phi, non-backedge input, `CanHoistUntaggingTo(pred)`, and
  `CheckpointedJump`.
- `maglev-phi-representation-selector.cc:341-357` leaves phis tagged for tagged
  uses, Uint32 uses, tagged inputs, IntPtr inputs, or empty input set.
- `maglev-phi-representation-selector.cc:589-668` hoisted speculative untagging
  uses checked conversions when an eager deopt frame exists; unsafe paths are
  only for known static Smi/Number cases.

## Remaining C1 Gaps

Still worth probing:

- phis feeding `ToBoolean`, `CheckMaps`, `CheckMaglevType`, and
  `TaggedForNumberToString`.
- nested loop phis where one phi is untagged and another later forced tagged.
- `--maglev-future` combined with range/truncation flags.
