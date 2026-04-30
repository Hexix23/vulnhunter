# C20 Wasm Shared Memory Grow Race Verdict

## Source Audit

Patch-derived root: `3dfcc338afd [wasm] Fix reset of Wasm memory buffer on shared growth`.

Target contracts:

- `WasmMemoryObject::Grow()` must only require this isolate's cached
  `array_buffer` to be reset after this thread actually grows the shared memory
  (`pages > 0`), not merely because another thread grew concurrently.
- `BroadcastSharedWasmMemoryGrow()` must request cross-isolate refreshes and
  update memory objects in the growing isolate.
- `UpdateSharedWasmMemoryObjects()` clears non-resizable cached
  `JSArrayBuffer`s only when `shared_ab->byte_length()` is less than the shared
  backing store's current byte length.
- JS-observable `memory.buffer.byteLength` must not regress, exceed maximum, or
  lag behind `memory.grow(0)`'s returned page count.

## H1 - upstream regression baseline

Verdict: `REFUTED-FIXED-REGRESSION`

PoC:

- `poc/h1-regression-baseline.js`

Evidence:

- `evidence/h1-release.txt`
- `evidence/h1-asan.txt`

Observed behavior:

- Release returned `OK`.
- ASAN + `repro.sh` returned `OK`.

Interpretation:

- The exact upstream regression shape is fixed in V8 14.8.178.9.

## H2 - main-thread buffer observer during worker grow(0)/grow(1) race

Verdict: `REFUTED-BUFFER-OBSERVER`

PoC:

- `poc/h2-buffer-observer-race.js`

Evidence:

- `evidence/h2-release.txt`
- `evidence/h2-asan.txt`

Observed behavior:

- Release returned `OK`.
- ASAN + `repro.sh` returned `OK`.
- The probe combined worker `grow(0)`/`grow(1)` with main-thread repeated
  `grow(0)` and `memory.buffer` reads.
- No byteLength regression, stale return-vs-buffer mismatch, or worker-visible
  negative grow result was observed.

Interpretation:

- The direct sibling where a non-growing thread observes concurrent growth and
  exposes stale/short buffer state did not reproduce.

## H3 - max-boundary grow(0) race

Verdict: `REFUTED-MAX-BOUNDARY`

PoC:

- `poc/h3-max-boundary-grow0-race.js`

Evidence:

- `evidence/h3-release.txt`
- `evidence/h3-asan.txt`

Observed behavior:

- Release returned `OK`.
- ASAN + `repro.sh` returned `OK`.
- Workers raced `grow(1)` until maximum while the main isolate repeatedly called
  `grow(0)` and checked `memory.buffer.byteLength`.
- Final visible buffer length matched `maximum * 65536`.

Interpretation:

- The boundary sibling did not expose stale buffer length, maximum overflow, or
  wrong `grow(0)` page count.

## H4 - resizable/fixed shared buffer toggle during grow race

Verdict: `REFUTED-RESIZABILITY-TOGGLE`

PoC:

- `poc/h4-resizable-toggle-grow-race.js`

Evidence:

- `evidence/h4-linux-dcheck.txt`

Observed behavior:

- Linux x64 DCHECK build returned `OK`.
- 25-run loop returned `OK-25`.
- Workers alternated `memory.grow(1)`, `memory.grow(0)`,
  `memory.toResizableBuffer()`, and `memory.toFixedLengthBuffer()`.
- Main isolate concurrently toggled resizability and checked that:
  `memory.grow(0) * 65536 <= memory.buffer.byteLength`,
  resizable buffer length did not regress, current buffer length did not
  regress, and fixed buffer length was not shorter than the synchronized
  `grow(0)` result.

Interpretation:

- The `ChangeArrayBufferResizability()` sibling did not reproduce on Linux.

## H5 - worker termination during grow broadcast

Verdict: `REFUTED-WORKER-TERMINATION`

PoC:

- `poc/h5-worker-terminate-during-grow.js`

Evidence:

- `evidence/h5-linux-dcheck.txt`

Observed behavior:

- Linux x64 DCHECK build returned `OK`.
- 15-run loop returned `OK-15`.
- Main isolate repeatedly terminated and replaced workers while all isolates
  shared the same Wasm memory and performed `grow(1)` / `grow(0)`.
- No crash, DCHECK, stale visible buffer, or length regression observed.

Interpretation:

- The global backing-store registry path did not expose an isolate-lifetime
  race under worker termination pressure.

## H6 - compiled Wasm atomic sink after stack-guard grow refresh

Verdict: `REFUTED-STACKGUARD-ATOMIC-SINK`

PoC:

- `poc/h6-stackguard-atomic-sink-after-grow.js`

Evidence:

- `evidence/h6-linux-sandbox-dcheck.txt`

Target:

- `GlobalBackingStoreRegistry::BroadcastSharedWasmMemoryGrow()` requests
  `GROW_SHARED_MEMORY` on non-growing isolates.
- `StackGuard::HandleInterrupts()` calls
  `BackingStore::UpdateSharedWasmMemoryObjects()`.
- Liftoff atomic memory sinks force explicit bounds checks via
  `BoundsCheckMem(..., kDoForceCheck, ...)`, loading
  `WasmTrustedInstanceData::kMemory0SizeOffset`.

Expected bug signal:

- Worker stays inside compiled Wasm while main grows shared memory.
- If worker's `WasmTrustedInstanceData` remains stale after loop backedge stack
  guard, atomic store/load at the first byte of the new page traps or
  mismatches.

Observed behavior:

- Linux x64 DCHECK build returned `OK`.
- Linux x64 sandbox DCHECK build returned `OK`.
- 50 repeated sandbox DCHECK runs returned `OK-50`.
- Worker stayed in compiled Wasm loop, main grew shared memory, then worker
  successfully performed `i32.atomic.store` and `i32.atomic.load` at the first
  byte of the new page.

Interpretation:

- The high-signal stack-guard starvation sibling did not reproduce for explicit
  atomic bounds-check sinks. `GROW_SHARED_MEMORY` interrupt processing refreshed
  the worker's `WasmTrustedInstanceData` before the atomic memory access.

## Overall

Verdict: `OPEN`

H1-H6 refute the exact fixed regression, four JS-observable siblings, and the
main lower-level stack-guard atomic sink. C20 is low-yield now unless a new
sink bypasses loop stack-guard processing entirely.
