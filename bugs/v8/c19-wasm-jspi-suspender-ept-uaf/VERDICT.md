# C19 - Wasm JSPI suspender EPT UAF

## H1 - upstream regress-501147587

Verdict: REFUTED on current fixed V8 14.8.178.9 checkout.

The Linux sandbox-enabled build now exposes the `Sandbox` memory corruption API and runs the upstream regression. Result is the expected fixed behavior: `suspender->stack` is cleared during cross-stack unwind, so the later resume resolves to null and sandbox testing reports:

```text
Caught harmless memory access violation (nullptr dereference). Exiting process...
```

Protective path:

- `/home/carlosgomez/v8-linux/v8/src/execution/isolate.cc:2718-2725`
- If exception/termination escapes the current suspender, V8 calls `suspender->set_stack(this, nullptr)` before retiring the active `StackMemory`.

Residual attack surface:

- Nested suspender chains where `parent == suspender->parent()->stack()` does not line up with logical unwind depth.
- Non-termination exceptions crossing multiple stack switches.
- Paths that retire a `StackMemory` outside this `PredictExceptionCatcher` unwind block.

## H2 - normal JS throw after resume

Verdict: REFUTED.

Replacing `%TerminateExecution()` with a normal imported JS throw still clears the suspender stack pointer. Manual second resume reaches:

```text
Caught harmless memory access violation (nullptr dereference). Exiting process...
```

Evidence: `evidence/h2-normal-throw-fixed.txt`.

## H3 - nested suspender chain, resume outer after terminate

Verdict: REFUTED.

Nested chain:

```text
outer WebAssembly.Suspending -> WebAssembly.promising(inner_export) -> inner WebAssembly.Suspending
```

After resolving inner, outer resumes, triggers termination, unwinds, GC runs, and manual second resume of the outer suspender reaches null rather than a freed `StackMemory`.

Evidence: `evidence/h3-nested-outer-fixed.txt`.

## H4 - nested suspender chain, resume inner after terminate

Verdict: REFUTED.

Same nested chain as H3, but the stale callback is the inner suspender. The fixed build again reports only a harmless null access.

Evidence: `evidence/h4-nested-inner-fixed.txt`.

## Current C19 status

C19 seed and first three variants are closed on this checkout. Linux sandbox infra is now usable:

- `/home/carlosgomez/v8-linux/v8/out/sandbox_dcheck_linux/d8`
- `--sandbox-testing --allow-natives-syntax --expose-gc`
- GN: `v8_enable_sandbox=true`, `v8_enable_memory_corruption_api=true`

Do not spend more time on exact JSPI stale-resume variants unless a new code path retires `StackMemory` outside `isolate.cc` unwind or `RetireWasmStack`.
