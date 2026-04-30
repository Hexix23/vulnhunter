# V8 C6 Slice - ObjectIs Kind Audit

**Date:** 2026-04-27
**Candidate:** `C6.S3`
**Surface:** Turboshaft machine lowering
**Violated contract:** Every `ObjectIsOp::Kind` enum value must be handled consistently by machine lowering. Missing or mismatched switch arms can turn a check into `UNREACHABLE`, wrong-code, or a mis-lowered predicate under optimization.

## Working set

- `src/compiler/turboshaft/operations.h:4995-5045`
  `ObjectIsOp::Kind` enum and `InputAssumptions`.
- `src/compiler/turboshaft/machine-lowering-reducer-inl.h:264-658`
  Main `REDUCE(ObjectIs)` lowering switch.
- `src/compiler/turboshaft/simplified-optimization-reducer.h:131-186`
  Earlier optimization-stage switch over the same enum.
- `src/compiler/turboshaft/operations.cc:1264-1306`
  Debug printer switch over the same enum.
- `src/compiler/turboshaft/graph-builder.cc:859-909`
  Call sites and `InputAssumptions`, especially `CheckInternalizedString`.

## Hypothesis

1. A newly-added `ObjectIsOp::Kind` exists in the enum and printer, but not in machine lowering.
2. A kind is present in the outer lowering switch, but omitted from a nested switch under one of the grouped cases.
3. `kInternalizedString` depends on `kHeapObject` assumptions that are not actually enforced by the Turboshaft graph builder.
