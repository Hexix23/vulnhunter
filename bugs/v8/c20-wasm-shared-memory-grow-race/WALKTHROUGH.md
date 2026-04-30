# C20 Walkthrough

This candidate replaces broad GC stress with a patch-derived race family.

The seed fix changed shared Wasm memory growth behavior after a concurrent
`grow(0)` could observe another thread's growth and trip the wrong buffer-reset
expectation. The next probes keep the exact ingredients: shared
`WebAssembly.Memory`, workers, `memory.buffer` access, `grow(0)`, `grow(1)`,
and maximum-boundary pressure.

Round 1:

- H1 copied the upstream regression shape into local artifacts. It passes on
  the fixed target.
- H2 added an active main-thread observer that repeatedly calls `grow(0)` while
  workers alternate `grow(0)` and `grow(1)`. It checks that visible buffer
  length never regresses and that `grow(0)`'s returned page count is not beyond
  the visible buffer.
- H3 pushes the same race to the maximum-page boundary.
- H4 adds shared-memory `toResizableBuffer()` and `toFixedLengthBuffer()`
  churn while workers grow the memory. This specifically hits
  `ChangeArrayBufferResizability()` plus the broadcast update path.
- H5 terminates and replaces workers while all isolates race on shared memory
  growth. This targets `GlobalBackingStoreRegistry::BroadcastSharedWasmMemoryGrow`
  and isolate lifetime pressure.

H1-H3 returned `OK` in release and ASAN on macOS. H4 returned `OK` on Linux x64
DCHECK and 25 repeated Linux runs. H5 returned `OK` on Linux x64 DCHECK and 15
repeated Linux runs. Continue C20 only with delayed stack-guard update
starvation, not by increasing generic worker counts.

Round 2 sink-first:

- Source sinks moved below JS `memory.buffer`: compiled Wasm memory accesses
  load `Memory0Start` / `Memory0Size` from `WasmTrustedInstanceData`.
- `BoundsCheckMem()` skips dynamic size checks for trap-handler plain loads but
  atomic memory operations force explicit bounds checks, so stale
  `Memory0Size` can cause a real trap/mismatch at a newly grown page.
- H6 keeps a worker inside compiled Wasm, lets main grow shared memory, then
  makes the worker perform `i32.atomic.store/load` at the old page boundary
  after stack-guard processing should refresh instance data.

H6 returned `OK` in Linux x64 DCHECK, `OK` in Linux x64 sandbox DCHECK, and
`OK-50` across repeated sandbox runs. This closes the strongest C20 sink found
so far: explicit atomic memory bounds checks see the refreshed memory size
before touching the grown page.
