# Draft: V8 aborts on valid shared custom descriptor allocation

## Title

V8: shared custom descriptor Wasm module reaches `UNIMPLEMENTED()` and aborts in release

## Product / Component

V8 / WebAssembly GC / custom descriptors / shared Wasm

## Version

- V8: 14.8.178.9
- Source: `branch-heads/14.8`, commit `209cf3b52af1ac949a6774ccd0b8843958fbab9d`
- Platform: macOS arm64
- Binaries:
  - ASan/debug: `/Users/carlosgomez/v8-engagement/v8/v8/out/asan/d8`
  - Release: `/Users/carlosgomez/v8-engagement/v8/v8/out/release/d8`

## Summary

A Wasm module using custom descriptors and shared types validates when `--wasm-staging --experimental-wasm-shared` is enabled, but allocating the shared descriptor-backed struct reaches `UNIMPLEMENTED()` and aborts the process in release.

There are two reachable crash paths:
- Global initializer / constant expression: `constant-expression-interface.cc:207-209`.
- Runtime function body allocation: `wasm-objects.cc:2192` via `Runtime_WasmAllocateDescriptorStruct`.

## Security Impact

Process-level denial of service behind experimental V8/Wasm feature flags.

Chrome VRP eligibility is likely limited because the repro requires `--experimental-wasm-shared`. The public Chrome VRP FAQ currently excludes V8 bugs specific to `--experimental` configurations from reward eligibility. This should still be fixed before shared custom descriptors are exposed more broadly.

## Minimal PoC

File: `poc/h9-minimal-raw.js`

Run:

```sh
/Users/carlosgomez/v8-engagement/v8/v8/out/release/d8 \
  --wasm-staging \
  --experimental-wasm-shared \
  bugs/v8/c7-wasm-canonical-types/poc/h9-minimal-raw.js
```

Expected:

Either:
- successful execution and `OK`, if the feature combination is supported; or
- a clean `WebAssembly.CompileError`/`LinkError`, if shared custom descriptors are intentionally unsupported.

Actual:

Release `d8` aborts with signal 5 / exit 133:

```text
Fatal error
unimplemented code
...
Runtime_WasmAllocateDescriptorStruct
Builtins_WasmAllocateDescriptorStruct
```

## Flag Gating

Observed:

```sh
d8 poc/h9-minimal-raw.js
```

Cleanly rejects:

```text
CompileError: WebAssembly.Module(): unknown type form: 101, enable with --experimental-wasm-shared
```

Observed:

```sh
d8 --experimental-wasm-shared poc/h9-minimal-raw.js
```

Cleanly rejects:

```text
CompileError: WebAssembly.Module(): descriptor types need --experimental-wasm-custom-descriptors
```

Observed:

```sh
d8 --wasm-staging --experimental-wasm-shared poc/h9-minimal-raw.js
```

Crashes release.

Important gate detail:

- `custom_descriptors` is a staged Wasm feature and can be enabled by
  `--wasm-staging`.
- `shared` is an experimental Wasm feature and is not enabled by
  `--wasm-staging`.
- The crash requires both. Removing only `--experimental-wasm-shared` makes the
  module reject during decoding before runtime allocation.

## Root Cause

The decoder accepts shared descriptor/describes pairs when the relevant feature flags are enabled. Validation checks descriptor symmetry and sharedness:

- `module-decoder-impl.h:846-861`: descriptor must describe the type and have matching sharedness.
- `module-decoder-impl.h:863-868`: describes must point back to the described type.

However, the allocation paths are not implemented for shared custom descriptors:

- `struct-types.h:88-91`: `InitializeOffsets()` calls `UNIMPLEMENTED()` for descriptor structs with `SharedFlag::kYes`.
- `wasm-objects.cc:2190-2192`: `WasmStruct::AllocateDescriptorUninitialized()` calls `UNIMPLEMENTED()` for shared descriptor structs.
- `constant-expression-interface.cc:207-209`: constant-expression allocation calls `UNIMPLEMENTED()` for shared descriptor structs.

So the feature is accepted far enough to reach process-fatal code instead of rejecting unsupported modules at validation time.

## Evidence

- `evidence/h9-minimal-raw-release.txt`
- `evidence/h9-shared-custom-descriptor-runtime-release.txt`
- `evidence/h8-shared-custom-descriptor-allocation-release.txt`
- `evidence/h9-minimal-raw-default.txt`
- `evidence/h9-minimal-raw-shared-only.txt`
- `evidence/h9-minimal-raw-staging-shared.txt`

## Suggested Fix Direction

If shared custom descriptors are not intended to be supported yet, reject this combination during module validation when a type is both a descriptor/described type and `SharedFlag::kYes`.

If they are intended to be supported, implement the shared descriptor layout/allocation path before allowing validation to accept such modules.
