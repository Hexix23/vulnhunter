# C7.S4 Verdict

## Source Audit

Target files:
- `src/wasm/canonical-types.cc`
- `src/wasm/canonical-types.h`
- `src/wasm/module-decoder-impl.h`
- `src/wasm/struct-types.h`
- `src/wasm/constant-expression-interface.cc`
- `src/wasm/wasm-objects.cc`

Key contracts:
- Recursive group canonicalization must remap in-group type indexes relative to each group (`canonical-types.cc:414-497`).
- Canonical equality must include `supertype`, `is_final`, `is_shared`, `descriptor`, `describes`, field types, nullability, and exactness (`canonical-types.h:341-395`).
- Invalid subtype cycles must be rejected before canonical supertypes are installed.
- Custom descriptor pairs must validate descriptor/describes symmetry and sharedness before runtime object creation.

## H1 - equivalent recursive group link

Verdict: `REFUTED-CANONICAL-EQUIVALENCE`

Evidence:
- `poc/h1-equivalent-recgroup-link.js`
- `evidence/h1-equivalent-recgroup-link-asan.txt`
- `evidence/h1-equivalent-recgroup-link-release.txt`

Observed behavior:
- ASan returned `OK`.
- Release returned `OK`.

Interpretation:
- Two independent modules with isomorphic two-type recursive groups canonicalized to compatible function import/export types.

## H2 - non-isomorphic recursive group reject

Verdict: `REFUTED-FALSE-MERGE`

Evidence:
- `poc/h2-nonisomorphic-recgroup-reject.js`
- `evidence/h2-nonisomorphic-recgroup-reject-asan.txt`
- `evidence/h2-nonisomorphic-recgroup-reject-release.txt`

Observed behavior:
- ASan returned `OK`.
- Release returned `OK`.
- The incompatible import was rejected with `WebAssembly.LinkError`.

Interpretation:
- Similar-looking recursive groups with different internal edges did not falsely canonicalize together.

## H3 - nullable vs non-nullable import reject

Verdict: `REFUTED-NULLABILITY-MERGE`

Evidence:
- `poc/h3-nullability-import-reject.js`
- `evidence/h3-nullability-import-reject-asan.txt`
- `evidence/h3-nullability-import-reject-release.txt`

Observed behavior:
- ASan returned `OK`.
- Release returned `OK`.
- A function returning `(ref null T)` did not satisfy an import expecting `(ref T)`.

Interpretation:
- Nullability remains part of canonical function type identity/subtyping.

## H4 - self-supertype reject

Verdict: `REFUTED-SUPERTYPE-CYCLE`

Evidence:
- `poc/h4-self-supertype-reject.js`
- `evidence/h4-self-supertype-reject-asan.txt`
- `evidence/h4-self-supertype-reject-release.txt`

Observed behavior:
- ASan returned `OK`.
- Release returned `OK`.
- A self-supertype recursive group was rejected at compile time.

Interpretation:
- The validator rejected a direct cycle before canonical supertype chains could become cyclic.

## H5 - mutual-supertype reject

Verdict: `REFUTED-SUPERTYPE-CYCLE`

Evidence:
- `poc/h5-mutual-supertype-reject.js`
- `evidence/h5-mutual-supertype-reject-asan.txt`
- `evidence/h5-mutual-supertype-reject-release.txt`

Observed behavior:
- ASan returned `OK`.
- Release returned `OK`.
- A two-type mutual-supertype cycle was rejected at compile time.

Interpretation:
- The validator rejected an indirect cycle before canonical supertype chains could become cyclic.

## H6 - equivalent descriptor recursive group link

Verdict: `REFUTED-DESCRIPTOR-EQUIVALENCE`

Evidence:
- `poc/h6-equivalent-descriptor-recgroup-link.js`
- `evidence/h6-equivalent-descriptor-recgroup-link-asan.txt`
- `evidence/h6-equivalent-descriptor-recgroup-link-release.txt`

Observed behavior:
- ASan returned `OK`.
- Release returned `OK`.

Interpretation:
- Equivalent custom descriptor/describes pairs canonicalized across modules.

## H7 - descriptor vs plain struct reject

Verdict: `REFUTED-DESCRIPTOR-IDENTITY`

Evidence:
- `poc/h7-descriptor-vs-plain-reject.js`
- `evidence/h7-descriptor-vs-plain-reject-asan.txt`
- `evidence/h7-descriptor-vs-plain-reject-release.txt`

Observed behavior:
- ASan returned `OK`.
- Release returned `OK`.
- A described struct did not canonicalize as a plain struct with identical fields.

Interpretation:
- `descriptor`/`describes` participate in canonical type identity as intended.

## H8 - shared custom descriptor allocation in global init

Verdict: `CONFIRMED-CRASH-EXPERIMENTAL`

Evidence:
- `poc/h8-shared-custom-descriptor-allocation.js`
- `evidence/h8-shared-custom-descriptor-allocation-asan.txt`
- `evidence/h8-shared-custom-descriptor-allocation-release.txt`
- `evidence/h8-release-no-staging.txt`
- `evidence/h8-release-no-shared-flag.txt`

Observed behavior:
- With `--experimental-wasm-custom-descriptors --experimental-wasm-shared`, ASan exits 133 with:
  - `Fatal error in ../../src/wasm/constant-expression-interface.cc, line 209`
  - `unimplemented code`
- Release also exits 133 with `Fatal error: unimplemented code`.
- The crash does not require `--wasm-staging`.
- Without `--experimental-wasm-shared`, the same module is rejected cleanly with `CompileError: unknown type form: 101, enable with --experimental-wasm-shared`.

Interpretation:
- V8 validates shared custom descriptor types but reaches `UNIMPLEMENTED()` during constant-expression/global initialization allocation instead of rejecting the module or handling the supported type form.
- Source anchor: `constant-expression-interface.cc:207-209` explicitly aborts when `type.is_descriptor()` and `type.is_shared == SharedFlag::kYes`.

## H9 - shared custom descriptor allocation in function body

Verdict: `CONFIRMED-CRASH-EXPERIMENTAL`

Evidence:
- `poc/h9-shared-custom-descriptor-runtime.js`
- `poc/h9-minimal-raw.js`
- `evidence/h9-shared-custom-descriptor-runtime-asan.txt`
- `evidence/h9-shared-custom-descriptor-runtime-release.txt`
- `evidence/h9-minimal-raw-release.txt`
- `evidence/h9-minimal-raw-default.txt`
- `evidence/h9-minimal-raw-shared-only.txt`
- `evidence/h9-minimal-raw-staging-shared.txt`

Observed behavior:
- With `--experimental-wasm-custom-descriptors --experimental-wasm-shared`, ASan exits 133 with:
  - `Fatal error in ../../src/wasm/wasm-objects.cc, line 2192`
  - `unimplemented code`
  - stack includes `WasmStruct::AllocateDescriptorUninitialized` and `Runtime_WasmAllocateDescriptorStruct`.
- Release also exits 133 with `Fatal error: unimplemented code`.
- The raw-byte minimized PoC also exits 133 in release with `--wasm-staging --experimental-wasm-shared`.
- Default release rejects cleanly with `CompileError: unknown type form: 101, enable with --experimental-wasm-shared`.
- With only `--experimental-wasm-shared`, release rejects cleanly with `CompileError: descriptor types need --experimental-wasm-custom-descriptors`.

Interpretation:
- This is the non-constant-expression version of H8. A valid module can instantiate, then a normal exported function call reaches unimplemented runtime allocation for shared custom descriptors.
- Source anchor: `struct-types.h:88-91` documents shared custom descriptor offset calculation as `UNIMPLEMENTED()`.

## H10-H13 - shipped canonical identity fields

Verdict: `REFUTED-SHIPPED-CANONICAL-MERGE`

Evidence:
- `poc/h10-final-vs-nonfinal-link.js`
- `poc/h11-struct-mutability-link.js`
- `poc/h12-packed-field-width-link.js`
- `poc/h13-array-mutability-link.js`
- matching `evidence/h10-*`, `evidence/h11-*`, `evidence/h12-*`, `evidence/h13-*` ASan and release outputs

Observed behavior:
- ASan returned `OK`.
- Release returned `OK`.
- Invalid cross-module function imports were rejected with `WebAssembly.LinkError`.

Interpretation:
- Shipped Wasm GC canonicalization did not falsely merge:
  - final vs non-final struct types;
  - mutable vs immutable struct fields;
  - `i8` vs `i16` packed field storage;
  - mutable vs immutable array element storage.

## H14-H15 - exact type link probes

Verdict: `GATED-BY-CUSTOM-DESCRIPTORS`

Evidence:
- `poc/h14-exactness-link.js`
- `poc/h15-exactness-return-link.js`
- `evidence/h14-exactness-link-release.txt`
- `evidence/h15-exactness-return-link-release.txt`
- `evidence/h14-exactness-link-asan.txt`
- `evidence/h15-exactness-return-link-asan.txt`

Observed behavior:
- Default release and ASan reject exact indexed heap types with:
  - `CompileError: WebAssembly.Module(): invalid heap type 'exact', enable with --experimental-wasm-custom-descriptors`

Interpretation:
- Exact indexed reference types are not a shipped route for removing the H8/H9 experimental dependency.

## H16-H19 - shipped subtype field variance

Verdict: `REFUTED-SHIPPED-SUBTYPE-VARIANCE`

Evidence:
- `poc/h16-mutable-struct-field-subtype-reject.js`
- `poc/h17-immutable-struct-field-covariance.js`
- `poc/h18-mutable-array-element-subtype-reject.js`
- `poc/h19-immutable-array-element-covariance.js`
- matching ASan and release evidence files

Observed behavior:
- ASan returned `OK`.
- Release returned `OK`.
- Mutable struct/array covariance was rejected.
- Immutable struct/array covariance was accepted as the positive control.

Interpretation:
- `wasm-subtyping.cc:18-83` enforces mutable-field invariance and immutable-field covariance as expected for shipped Wasm GC.

## H20-H22 - singleton and recgroup boundary identity

Verdict: `REFUTED-SHIPPED-RECGROUP-BOUNDARY`

Evidence:
- `poc/h20-self-recursive-singleton-link.js`
- `poc/h21-self-vs-mutual-recursive-reject.js`
- `poc/h22-recgroup-boundary-reject.js`
- matching ASan and release evidence files

Observed behavior:
- ASan returned `OK`.
- Release returned `OK`.
- Equivalent self-recursive singleton groups linked.
- Non-equivalent singleton vs mutual recursion and external-vs-internal recgroup references were rejected.

Interpretation:
- `AddRecursiveSingletonGroup()` and `CanonicalEquality::EqualTypeIndex()` handled the tested singleton and recgroup-boundary cases correctly.

## Overall

Verdict: `CONFIRMED-CRASH-EXPERIMENTAL`

C7 did not expose canonical type false-merges in H1-H7 or in the additional shipped probes H10-H13 and H16-H22. H14-H15 are gated by the same custom-descriptors feature family and are not a default-release route. The useful finding remains narrower: shared custom descriptor types are accepted under experimental feature flags, but allocation paths abort in both ASan and release.

Impact is currently below Chrome VRP memory-safety threshold because it requires experimental Wasm feature flags. It is still a concrete upstream V8 correctness/DoS bug: valid experimental-feature Wasm reaches process-fatal `UNIMPLEMENTED()` instead of compile/link rejection or runtime handling.

## VRP Escalation Check

Current public Chrome VRP FAQ says bugs in unlaunched/flagged code can be interesting, but security bugs in V8 behind `--experimental` are the exception and are not eligible for Chrome VRP rewards. H8/H9 currently require `--experimental-wasm-shared`; therefore the honest classification is upstream V8 reportable, not Chrome VRP rewardable as of this triage.

The route to VRP eligibility would be finding a path that removes `--experimental-wasm-shared`, e.g. an origin-trial/field-experiment exposure or a shipped configuration where shared Wasm GC/custom descriptors can be reached without experimental V8 flags. Current local release testing did not find that path.
