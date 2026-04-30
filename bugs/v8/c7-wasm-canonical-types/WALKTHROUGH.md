# C7.S4 Walkthrough

## Slice

C7 targets WebAssembly canonical type handling in `src/wasm/canonical-types.{cc,h}`. The original hypothesis was that adversarial recursive groups could be canonicalized too broadly or too narrowly, producing wrong import/link decisions or stale canonical supertype chains.

The source audit focused on:
- `TypeCanonicalizer::AddRecursiveGroup()` and singleton handling.
- `CanonicalizeTypeDef()` remapping of in-group type indexes.
- `CanonicalHashing` and `CanonicalEquality` for relative recursive group identity.
- Custom descriptor/describes support because the same canonical type object stores `descriptor` and `describes`.

## Probes

H1 built two modules with equivalent two-type recursive groups and linked an exported function into an importing module with the independently built equivalent type.

H2 used similar-looking but non-isomorphic recursive groups and required link-time rejection.

H3 checked nullable vs non-nullable typed refs in function return type matching.

H4 and H5 checked direct and mutual supertype cycles.

H6 and H7 extended the same canonicalization checks to custom descriptor/describes pairs.

H8 shifted from canonical identity to runtime support: shared custom descriptors are accepted by validation tests, so the PoC allocated one through a global initializer.

H9 minimized H8 into normal function-body allocation, proving the crash is not limited to constant-expression evaluation.

H10-H13 removed `--experimental-wasm-shared` and custom descriptors entirely, then tested shipped Wasm GC canonical identity fields: `final`, struct field mutability, packed field width, and array mutability.

H14-H15 tried exact indexed reference types as a possible non-shared escalation route. Default release rejected the feature because exact indexed heap types are also behind `--experimental-wasm-custom-descriptors`.

H16-H19 tested shipped explicit-subtype variance rules for struct and array fields. Mutable field covariance must be rejected; immutable covariance must be accepted.

H20-H22 tested singleton recursion and recgroup boundary handling: equivalent self-recursive singleton groups, self-vs-mutual recursion, and external-vs-internal reference edges.

## Outcome

H1-H7 were refuted cleanly in ASan and release.

H8-H9 are confirmed release crashes behind experimental flags:
- H8: `constant-expression-interface.cc:209` `UNIMPLEMENTED()` during global initialization.
- H9: `wasm-objects.cc:2192` / `Runtime_WasmAllocateDescriptorStruct` path, with `struct-types.h:88-91` documenting shared custom descriptor offset calculation as unimplemented.

H10-H13 and H16-H22 were also clean in default release and ASan. They did not provide a non-experimental escalation path from H8/H9.

H14-H15 were not usable for release escalation because exact indexed refs are rejected without `--experimental-wasm-custom-descriptors`.

This is not a VRP-grade memory safety bug as-is because it depends on experimental Wasm flags. It is a solid upstream correctness/DoS report candidate and a useful primitive to track if shared custom descriptors move toward default exposure.
