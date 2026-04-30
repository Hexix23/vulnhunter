# P1-C Verdict

Status: in progress.

## W1 - `WebAssembly.Module.customSections`

Target: `src/wasm/wasm-module.cc:GetCustomSections`.

Hypothesis: `wire_bytes` is derived from a temporary
`module_object->native_module()` `Ptr`; later allocations could use the vector
after the `Ptr` lifetime ended.

Current assessment: REFUTED-STANDALONE for direct JS stress; remains a
post-corruption hardening sink candidate.

Direct JS reachability is strong through `WebAssembly.Module.customSections`.
Standalone UAF is not expected unless the module object can stop anchoring the
`Managed<NativeModule>` during the call or prior corruption mutates the managed
external pointer. Need empirical stress and source proof.

Evidence:

- `poc/w1-custom-sections-gc-stress.js`.
- `evidence/w1-release.txt`: exit 0.
- `evidence/w1-asan.txt`: exit 0.
- `evidence/w1-release-stress-marking.txt`: exit 0.
- `evidence/w1-asan-stress-marking.txt`: exit 0.

Interpretation:

The pattern is source-suspicious because `wire_bytes` outlives the temporary
`Managed<>::Ptr`, but default JS does not free the underlying `NativeModule`
while the `WasmModuleObject` handle is live. No standalone UAF under release,
ASAN, or stress marking.

Next useful Wasm lifetime targets:

- Debug/DevTools name paths (`debug-wasm-objects.cc`) if we can trigger them
  from d8 or a C++ test.
- Serialization/deserialization paths where `native_module.raw()` is passed
  into a helper that may allocate.
- Post-corruption chain analysis only after we have a separate in-sandbox
  corruption primitive.
