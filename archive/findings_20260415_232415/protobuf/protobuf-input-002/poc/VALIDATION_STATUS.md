# VALIDATION_STATUS.md

## Finding: protobuf-input-002

**Status:** NEEDS_INVESTIGATION

**Validated Against:**
- Library: prebuilt ASan protobuf libraries from `builds/protobuf-asan-arm64/`
- Build: `builds/protobuf-asan-arm64/`
- Date: 2026-04-15

**Compilation:**
```bash
./build_real.sh
```

**Evidence:**
- ASan Output: `asan_output.txt`
- Result: control serialization through the compiled library succeeded without an ASan finding
- Constraint: the truncation only manifests if `output_size > UINT32_MAX`, and that oversized response was not reproduced in this environment

**Conclusion:** The real compiled library path was exercised, but this run did not confirm a memory corruption bug. The finding remains an unconfirmed framing/logic concern that would require a reproducible >4 GiB serialized response to validate.
