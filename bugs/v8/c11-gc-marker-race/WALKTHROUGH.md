# C11.S6 Walkthrough

## Slice

Candidate C11 targets GC/marker races in shared heap and write-barrier paths. The CVE-derived motivation was the recent 2025/2026 shift toward race and inappropriate-implementation bugs, including V8 race entries in the recon notes.

Audited contracts:
- `src/heap/heap-write-barrier.cc`: thread-local current marking barrier and shared slow paths.
- `src/heap/marking-barrier.cc`: shared/client activation, `JSArrayBuffer` extension marking, descriptor-array custom liveness.
- `src/heap/marking-barrier-inl.h`: client-isolate shared heap `MarkValueShared` split.
- `src/heap/incremental-marking.cc`: major vs minor marking activation order.
- `src/objects/js-array-buffer.h`: native `ArrayBufferExtension` mark state and young-generation state.
- `test/cctest/heap/test-heap.cc:7009-7049`: `Regress8617`, stale descriptor value precedent.

## Hypotheses

H1 checked client-isolate writes into `SharedStructType` while the main isolate repeatedly forced major/shared marking. It targeted missing shared worklist activation or a wrong current marking barrier.

H2 checked old local holders pointing at shared strings, looking for missed OLD_TO_SHARED slots under stress marking.

H3 interleaved worker creation/shutdown, minor marking, and shared major GC to look for page flag or activation-order mismatch.

H4 reused the shared external string forwarding-table shape from existing regressions and forced async GC.

H5 optimized shared value stores into `SharedArray` and `SharedStructType`, looking for optimized-code barrier elision.

H6 narrowed to `ArrayBufferExtension`: resizable `ArrayBuffer` and growable `SharedArrayBuffer` publication/grow under async major/minor GC and shared GC.

H7 narrowed to descriptor arrays: a JS-level version of `Regress8617` with function-valued descriptors, descriptor growth, compaction, verification, and post-GC method use.

## Outcome

All seven probes returned `OK` in ASan where applicable and in release. The round did not find a confirmed crash, divergence, or miscompile.

The useful result is negative coverage: broad JS-accessible shared heap and marker-race shapes appear protected. More value from S6 now requires patch-diffing specific race fixes or moving into C++ API/embedder paths that JS cannot precisely schedule.
