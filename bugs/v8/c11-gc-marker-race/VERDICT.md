# C11.S6 Verdict

## Source Audit

Target files:
- `src/heap/heap-write-barrier.cc`
- `src/heap/marking-barrier.cc`
- `src/heap/marking-barrier-inl.h`
- `src/heap/incremental-marking.cc`

Key contracts:
- `WriteBarrier::CurrentMarkingBarrier()` reads a thread-local marking barrier and, in debug, checks it matches `LocalHeap::Current()->marking_barrier()`.
- `MarkingBarrier::ActivateAll()` activates local barriers and, for the shared-space isolate, activates shared worklists in client isolates.
- Client isolates writing into shared heap objects must use the shared marking path (`MarkValueShared`) when major shared marking is active.
- Minor marking activates young-generation page flags only; shared-space page flags are major-marking only.
- Shared strings and shared structs must not create shared-to-local edges, and old-to-shared slots must remain visible to GC.

## H1 - shared struct worker writes during major/shared marking

Verdict: `REFUTED-SHARED-BARRIER-ACTIVE`

Evidence:
- `poc/h1-shared-struct-worker-major.js`
- `evidence/h1-asan.txt`
- `evidence/h1-release.txt`
- `evidence/h1-trace.txt`

Observed behavior:
- ASan + `--verify-heap` + shared heap + `--stress-marking=99` returned `OK`.
- Release returned `OK`.
- Trace shows repeated `IncrementalMarking` starts, black allocation, marking steps, and stops while worker writes into a shared struct (`h1-trace.txt:3-17`, `:24-35`, `:57-64`).

Interpretation:
- This hit the client-isolate shared marking barrier path without a wrong current barrier, missing shared worklist, or shared heap corruption.

## H2 - old local object to shared string slots

Verdict: `REFUTED-OLD-TO-SHARED`

Evidence:
- `poc/h2-old-to-shared-string-slot.js`
- `evidence/h2-asan.txt`
- `evidence/h2-release.txt`

Observed behavior:
- ASan + `--verify-heap` + shared heap + stress marking returned `OK`.
- Release returned `OK`.

Interpretation:
- Repeated writes from an old local holder to shared strings did not expose a missing OLD_TO_SHARED barrier or remembered-set corruption.

## H3 - minor/major worker interleave

Verdict: `REFUTED-MINOR-MAJOR-ORDERING`

Evidence:
- `poc/h3-minor-major-worker-interleave.js`
- `evidence/h3-asan.txt`
- `evidence/h3-release.txt`

Observed behavior:
- ASan + `--minor-ms` + `--verify-heap` + stress marking returned `OK`.
- Release returned `OK`.

Interpretation:
- Worker isolate creation/shutdown, minor marking, shared heap, and major/shared GC did not trigger page flag inconsistency or ActivateYoung/ActivateAll ordering failure.

## H4 - shared external string forwarding table during async GC

Verdict: `REFUTED-FORWARDING-TABLE-GC`

Evidence:
- `poc/h4-shared-external-string-forwarding.js`
- `evidence/h4-asan.txt`
- `evidence/h4-release.txt`
- `evidence/h4-trace.txt`

Observed behavior:
- ASan + `--verify-heap` + shared heap + stress marking returned `OK`.
- Release returned `OK`.
- Trace shows repeated incremental marking start/stop cycles under the forwarding-table workload (`h4-trace.txt:3-12`, `:23-31`, `:83-92`).

Interpretation:
- The 2025 shared external string forwarding-table regression shape does not reproduce a marker race or stale forwarding entry under this stress profile.

## H5 - optimized shared value barrier

Verdict: `REFUTED-SHARED-VALUE-BARRIER`

Evidence:
- `poc/h5-optimized-shared-value-barrier.js`
- `evidence/h5-asan.txt`
- `evidence/h5-release.txt`

Observed behavior:
- ASan + `--verify-heap` + optimized stores into shared objects returned `OK`.
- Release returned `OK`.
- Final `%SharedGC()` did not report shared-to-local edges.

Interpretation:
- Optimized code did not incorrectly elide the shared value barrier for HeapNumber-like values under marking stress.

## H6 - ArrayBufferExtension marking during resize/grow

Verdict: `REFUTED-EXTENSION-MARKING`

Evidence:
- `poc/h6-arraybuffer-extension-marking.js`
- `evidence/h6-asan.txt`
- `evidence/h6-release.txt`

Observed behavior:
- ASan + `--verify-heap` + shared heap + stress marking returned `OK`.
- Release returned `OK`.
- The PoC repeatedly publishes `ArrayBufferExtension` objects through resizable `ArrayBuffer`, grows `SharedArrayBuffer`, and forces async major/minor GC plus `%SharedGC()`.

Interpretation:
- `MarkingBarrier::Write(Tagged<JSArrayBuffer>, ArrayBufferExtension*)` did not lose a native backing-store extension or confuse major `Mark()` with young-generation `YoungMark()` for this JS-accessible publication/grow pattern.

## H7 - descriptor array custom liveness during compaction

Verdict: `REFUTED-DESCRIPTOR-LIVENESS`

Evidence:
- `poc/h7-descriptor-array-custom-liveness.js`
- `evidence/h7-asan.txt`
- `evidence/h7-release.txt`

Observed behavior:
- ASan + `--verify-heap` + `--stress-compaction` + `--stress-incremental-marking` returned `OK`.
- Release returned `OK`.
- The PoC approximates `test/cctest/heap/test-heap.cc:7009-7049` (`Regress8617`): create a function referenced from a descriptor array, start GC stress, grow the descriptor set, verify the object, and call the descriptor-backed method after compaction.

Interpretation:
- `MarkingBarrier::Write(Tagged<DescriptorArray>, int)` and `DescriptorArrayMarkingState::TryUpdateIndicesToMark()` handled this descriptor growth pattern without a stale descriptor value, missed slot publication, or verifier failure.

## Overall

Verdict: `OPEN`

This is a real C11 pivot, not a closed S6 audit. H1-H7 cover the obvious JS-accessible shared heap and marker-race shapes: client shared writes, OLD_TO_SHARED slots, minor/major interleaving, shared external string forwarding, optimized shared value barriers, ArrayBufferExtension marking, and descriptor-array custom liveness. No VRP-grade bug is confirmed in this first round.

Next S6 work should go narrower than JS stress PoCs: patch-diff the 2025/2026 race fixes, inspect C++-only embedder/API paths that can install array-buffer extensions or descriptors under marking, or move to C7/C16 to preserve anti-anchoring diversity.
