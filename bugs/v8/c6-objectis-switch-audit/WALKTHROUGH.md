# C6.S3 Walkthrough

## Scope

This was a mechanical review of `ObjectIsOp::Kind` coverage rather than a runtime probe. The candidate hypothesis was that a new enum value might have been added without a corresponding machine-lowering arm.

## What was checked

1. Enumerated every `ObjectIsOp::Kind` value from `operations.h`.
2. Compared that set against the outer `switch (kind)` in `machine-lowering-reducer-inl.h`.
3. Checked grouped branches for nested-switch omissions.
4. Verified that `kInternalizedString` is only emitted with `HeapObject` assumptions by the graph builder.

## Result

No missing enum coverage was found.

- Outer switch coverage is complete.
- Nested grouped switches are complete for the kinds they group.
- `kInternalizedString` is guarded by a matching call-site assumption.

## Residual risk

This closes the narrow “missing enum arm” hypothesis only. It does not prove semantic correctness of each predicate. If we stay on S3, the next better target is `C5.S3`: make Turbolev produce an `ObjectIs` on a speculated value and look for wrong-code under deopt-resistant inputs.
