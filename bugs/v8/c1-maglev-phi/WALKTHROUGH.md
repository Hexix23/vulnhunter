# C1 Maglev Phi Walkthrough

## Slice

Goal was impact-first: find wrong-code / type confusion from Maglev phi
representation selection.

Source audit focused on:

- static Smi/Number handling;
- unsafe untagging paths;
- peeled backedge speculation;
- speculative hoisted untagging;
- retagging/deopt behavior.

## Code Risk

The suspicious part is that known static types can select unsafe conversions:

- `KnownSmi` can become `UnsafeSmiUntag`.
- `KnownNumber` can become `UnsafeNumberToFloat64`.

If static type knowledge becomes stale after a side-effecting path, that can be
wrong-code or type confusion.

Speculative hoist adds another risk: conversion moved to predecessor block. The
source mitigates this by requiring `CheckpointedJump` for `kSpeculativeAny`, so
bad input can deopt at predecessor.

## Probes

Three PoCs were written:

- `poc/h1-sideeffect-number-phi.js`: train Smi loop, then feed HeapNumber via
  `valueOf()`.
- `poc/h2-trycatch-phi-heapnumber.js`: train no-throw path, then catch path
  writes HeapNumber.
- `poc/h3-peeled-backedge-heapnumber.js`: train peeled loop with Int32-like
  backedge, then late HeapNumber backedge.

Each PoC compares a never-optimized reference function to Maglev-optimized
function and prints `%ActiveTierIsMaglev(opt)` before and after trigger.

## Result

All tested shapes matched interpreter and deoptimized after trigger. No crash,
no DCHECK, no release divergence.

Strongest useful fact:

```text
maglev_after_warm=true
maglev_after_got=false
```

So these were real Maglev executions, not dead tests.

## Next

Do not spend more time on these exact shapes. If continuing C1, move to uses
where a bad representation crosses object boundaries: stores, write barriers,
boolean/type checks, or retagging chains.

