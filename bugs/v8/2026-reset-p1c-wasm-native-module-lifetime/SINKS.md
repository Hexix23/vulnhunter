# P1-C Wasm NativeModule Lifetime Sinks

Date: 2026-04-28
Threat model: `docs/threat-models/2026-04-28-v8-2026-cve-threat-model-reset.md`

Prior CVE class: 2026 V8 UAF (`CVE-2026-5861`, `CVE-2026-5904`) and local
fix signal `b6302d64ffd [wasm] Avoid UaF via WasmModuleObject::native_module()`.

## Invariant

Any JS-visible `WasmModuleObject` access to `NativeModule` must keep the
underlying `std::shared_ptr<NativeModule>` alive for the whole period where
derived raw pointers/vectors are used, especially across allocation, GC, debug
callbacks, coverage, serialization, and name extraction.

Safe pattern:

```cpp
Managed<wasm::NativeModule>::Ptr native_module = module_object->native_module();
base::Vector<const uint8_t> wire_bytes = native_module->wire_bytes();
// use wire_bytes while native_module remains in scope
```

Suspicious pattern:

```cpp
base::Vector<const uint8_t> wire_bytes =
    module_object->native_module()->wire_bytes();
// Ptr temporary is gone; later allocations use wire_bytes
```

This suspicious pattern is not automatically a direct UAF because the
`WasmModuleObject` handle normally keeps its `Managed` object alive. It matters
for post-corruption/sandbox-hardening and for any path where the JS object or
script can stop anchoring the `NativeModule` while derived data is still used.

## Initial Sink Inventory

| ID | Location | Pattern | Risk |
|---|---|---|---|
| W1 | `src/wasm/wasm-module.cc:GetCustomSections` | Stores `wire_bytes` from a temporary `module_object->native_module()` and then allocates strings/arrays while using it. | Strongest sink candidate; JS reachable via `WebAssembly.Module.customSections`. |
| W2 | `src/debug/debug-wasm-objects.cc` globals/memories/tables names | Calls `module_object()->native_module()->GetNamesProvider()` and then allocates a `StringBuilder` result. | Debug-only reachability; likely lower VRP unless DevTools/debug API reachable. |
| W3 | `src/debug/debug-interface.cc` debug symbols | Mostly stores `Managed<>::Ptr`, but one loop reconstructs `ModuleWireBytes` from `script->wasm_native_module()->wire_bytes()` inside expression. | Debug API only. |
| W4 | `src/runtime/runtime-test-wasm.cc` | Multiple `module_object->native_module()` uses. | Test-only runtime, not VRP surface. |

## First PoC Target

W1 `WebAssembly.Module.customSections` with:

- default flags only;
- module with many custom sections and large names/payloads to force allocation;
- repeated `customSections()` calls under `gc()` pressure;
- release vs ASAN behavior.

Expected safe behavior: returns copied `ArrayBuffer`s with correct payloads, no
crash.

Reportability bar: default ASAN/release crash or data corruption without using
sandbox memory corruption APIs. If only post-corruption sink, catalog as chain
candidate, not standalone VRP.
