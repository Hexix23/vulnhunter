# V8 C11 Slice - GC Marker Race

Date: 2026-04-27
Target: V8 14.8.178.9
Surface: S6 GC x marker race

## Threat Contract

The GC assumes write barriers publish every edge or native extension that can become visible while marking is active. C11 focuses on races where marking starts/stops across local/client/shared isolates and a write barrier records the wrong worklist, misses a slot, or applies young-generation marking to a major-marking object.

Primary source points:
- `src/heap/heap-write-barrier.cc`: current marking barrier and shared slow paths.
- `src/heap/marking-barrier.cc:128-200`: `JSArrayBuffer` extension barrier and descriptor-array barrier.
- `src/heap/marking-barrier-inl.h`: shared heap `MarkValueShared` split.
- `src/heap/incremental-marking.cc`: `ActivateAll()` vs `ActivateYoung()` ordering.
- `src/objects/js-array-buffer.h:219-335`: native `ArrayBufferExtension` state.

## Probes Run

Artifacts: `bugs/v8/c11-gc-marker-race/`

- H1 shared struct worker writes during major/shared marking: refuted.
- H2 old local object to shared string slots: refuted.
- H3 minor/major worker interleave: refuted.
- H4 shared external string forwarding table during async GC: refuted.
- H5 optimized shared value barrier: refuted.
- H6 ArrayBufferExtension marking during resize/grow: refuted.
- H7 descriptor array custom liveness during compaction: refuted.

## Current Verdict

`OPEN`, no confirmed VRP-grade primitive.

This slice now has meaningful negative coverage for JS-accessible shared heap/marker race shapes. Further S6 work should not be more generic GC stress. The next useful steps are patch-diffing recent V8 race fixes, C++ API/embedder paths that can install extensions/descriptors under marking, or pivoting to another P1 surface to keep methodology diversity.
