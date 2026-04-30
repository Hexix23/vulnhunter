# C012 Verdict

Status: `PUBLIC-REGRESSION-PASSES / VARIANT-SEARCH-IN-PROGRESS`

Baseline:

- Upstream regression `SurfaceTest.RentrantSurfaceActivationGroups` passes
  under ASan.
- Evidence: `evidence/upstream-regression-baseline.txt`.

Initial risk:

- Public patch confirms real UAF class: live vector invalidation during Viz
  surface allocation-group iteration.
- Candidate remains VRP-relevant if sibling loop or incomplete fix reaches
  renderer-controlled surface/frame-sink state.

Current variant notes:

- `SurfaceManager::HasBlockedEmbedder()` still iterates the live
  `frame_sink_id_to_allocation_groups_` vector, but currently calls only
  `SurfaceAllocationGroup::HasBlockedEmbedder()`, which is a const/non-mutating
  check.
- `MaybeGarbageCollectAllocationGroups()` erases allocation groups from the
  frame-sink vector while iterating the embed-token map; it resets destroyed
  entries in a separate pass and then erases null entries. Need stress with
  destructor/observer paths, but direct destructor DCHECKs require empty sets.
