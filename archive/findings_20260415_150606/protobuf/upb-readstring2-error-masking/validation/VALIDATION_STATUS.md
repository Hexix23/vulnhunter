# VALIDATION_STATUS.md

## Finding: upb-readstring2-error-masking

**Status:** FALSE_POSITIVE

**Validated Against:**
- Library: `libupb.a` from the protobuf ASan build
- Build: `builds/protobuf-asan-arm64/`
- Commit: `514aceb97`
- Date: `2026-04-15`

**Compilation:**
```bash
./build_real.sh
```

**Evidence:**
- PoC: `bugs/protobuf/upb-readstring2-error-masking/poc/poc_real.cpp`
- Runtime output: `bugs/protobuf/upb-readstring2-error-masking/poc/asan_output.txt`
- Exit code: `0`

**Observed behavior:**
```text
valid: status=0 (Ok)
truncated: status=2 (Wire format was corrupt)
no reproduction: library reports Malformed
```

**Why Not Vulnerable:**
- A fresh PoC decoded a real generated message type through the compiled `upb_Decode()` implementation in `libupb.a`.
- The malformed truncated string field was rejected as `kUpb_DecodeStatus_Malformed`.
- No AddressSanitizer finding occurred.
- The suspected error-masking path from source analysis does not reproduce in the shipped compiled library under this input.

**Conclusion:** The finding is not confirmed against the real ASan build. The library correctly reports malformed wire data for this test case.
