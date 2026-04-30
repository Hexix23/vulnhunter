# C012 Surface Allocation Group Mutation

Source lineage:

- CVE-2026-7333, issue `493955227`
- Main patch: <https://chromium-review.googlesource.com/c/chromium/src/+/7707244>

Patch fingerprint:

- File: `components/viz/service/surfaces/surface_manager.cc`
- Fixed sink: loop over `frame_sink_id_to_allocation_groups_`.
- Patch copies the allocation-group vector before iterating because operations
  reached from the loop can mutate the live vector.

Invariant:

- Never iterate a live allocation-group vector while calling methods that may
  add/remove allocation groups for the same `FrameSinkId`.
- Snapshot first, or use an iterator-stable container plus explicit lifetime
  ownership.

Probe plan:

1. Identify exact upstream regression test name from `surface_unittest.cc` or
   `surface_manager_unittest.cc`.
2. Replay regression under ASan gtest.
3. Search sibling loops over `frame_sink_id_to_allocation_groups_` and
   group-owned vectors.
4. Add local gtest variants where callbacks/destructors mutate group membership
   during iteration.

