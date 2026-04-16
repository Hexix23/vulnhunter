# VALIDATION_STATUS.md

## Finding: protobuf-input-002

**Status:** NEEDS_INVESTIGATION

**Validated Against:**
- Library: prebuilt ASan protobuf runtime from `builds/protobuf-asan-arm64/`
- Build: `builds/protobuf-asan-arm64/`
- Location under review: `targets/protobuf/upb/conformance/conformance_upb.c:288`
- Date: 2026-04-15

**Environment:**
- OS: Darwin
- Arch: arm64
- Rosetta: No

**Compilation:**
```bash
./build_real.sh
```

**Execution:**
```bash
ASAN_OPTIONS=detect_leaks=0:abort_on_error=0 ./poc_real /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf
```

**Evidence:**
- Build log: `compile_err.txt`
- Runtime log: `asan_output.txt`
- JSON result: `asan_result.json`
- Feedback: `state/current_run/validation_feedback.json`

**Attempts:**
1. Compiled the existing dynamic-message harness against the shipped ASan protobuf libraries.
2. Ran the harness under ASan.
3. Retried by generating matching C++ stubs with the prebuilt `protoc`.

**What Worked:**
- The harness linked successfully against the prebuilt ASan protobuf libraries.

**What Failed:**
- The importer-based harness crashed before reaching the reported framing site, in `google::protobuf::DescriptorPool::Tables::Tables()` while constructing the descriptor pool.
- The prebuilt `builds/protobuf-asan-arm64/bin/protoc` also aborted internally before it could generate replacement `conformance.pb.cc` files for a cleaner harness.
- This build artifact set does not include a prebuilt `conformance_upb` executable, so the exact `DoTestIo()` path could not be exercised without rebuilding target binaries.

**Why The Finding Is Still Unconfirmed:**
- The reported bug is a 64-bit-to-32-bit framing truncation at `conformance_upb.c:288`, not a direct memory corruption primitive.
- Confirming it requires reaching a real `output_size > UINT32_MAX` response or otherwise exercising the exact framing code in `DoTestIo()`.
- Neither condition was achieved with the available compiled artifacts.

**Conclusion:** The reported cast from `size_t` to `uint32_t` is a plausible framing bug, but the available compiled artifacts did not let this run confirm it on the real `DoTestIo()` path. The conservative outcome is `NEEDS_INVESTIGATION` for the learning loop and `NO_CRASH` for the requested validator JSON.
