# VALIDATION_STATUS.md

## Finding: protobuf-input-001

**Status:** NEEDS_INVESTIGATION

**Validated Against:**
- Library build: `builds/protobuf-asan-arm64/`
- Present archives: `libprotobuf.a`, `libprotoc.a`, `libupb.a`, `libutf8_range.a`, `libutf8_validity.a`
- Vulnerable source path: `targets/protobuf/upb/conformance/conformance_upb.c:253`
- Date: 2026-04-15

**Compilation:**
```bash
xcrun clang++ -arch arm64 $(cat builds/protobuf-asan-arm64/compile_flags.txt) \
  -Itargets/protobuf \
  bugs/protobuf/protobuf-input-001/poc/poc_real.cpp \
  $(cat builds/protobuf-asan-arm64/link_flags.txt) \
  builds/protobuf-asan-arm64/lib/libupb.a \
  -o bugs/protobuf/protobuf-input-001/poc/poc_real.recheck
```

**Execution:**
```bash
ASAN_OPTIONS=detect_leaks=0:abort_on_error=0 \
  bugs/protobuf/protobuf-input-001/poc/poc_real.recheck \
  2>&1 | tee bugs/protobuf/protobuf-input-001/poc/asan_output.txt
```

**Evidence:**
- The supplied ASan build exists and was used directly; nothing was rebuilt from source.
- The PoC links against the real archived library objects, specifically `libupb.a`.
- Runtime output was:
  - `linked_libupb requested=4294967295 ptr=0x300004810`
  - `allocator returned non-NULL`
- The process exited with code `0`.
- No AddressSanitizer report was emitted.

**Limitation:**
- The original sink for this finding is `DoTestIo()` in `conformance_upb.c`.
- That executable path is not present in the supplied archived build artifacts, so the exact compiled sink could not be exercised against the real build bundle provided for validation.

**Conclusion:**
- Revalidation against the real compiled library did **not** confirm memory corruption.
- Current state is **NEEDS_INVESTIGATION** rather than confirmed: the available archives do not expose the original sink, and the linked-library fallback PoC produced **no crash**.
