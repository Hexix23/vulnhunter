# VALIDATION_STATUS.md

## Finding: Unbounded stdin length drives arena allocation in conformance harness

**Status:** LOGIC_BUG

**Validated Against:**
- Library: `libupb.a`
- Build: `builds/protobuf-asan-arm64/`
- Commit: `4adbfee`
- Date: `2026-04-15T16:56:27Z`

**Environment:**
- OS: `Darwin`
- Host Arch: `x86_64`
- Binary Arch: `arm64`
- Compiler that worked: `xcrun clang++ -arch arm64`

**Compilation Attempts:**
1. Homebrew `clang++` with bundle flags -> failed with `___asan_version_mismatch_check_apple_clang_2100`
2. Homebrew `clang++` plus Homebrew include/lib paths -> same ASan mismatch
3. Homebrew `clang++ -stdlib=libc++` -> same ASan mismatch
4. `xcrun clang++ -arch arm64` with bundle flags -> success

**Compilation Command:**
```sh
xcrun clang++ -arch arm64 $(cat builds/protobuf-asan-arm64/compile_flags.txt) \
  bugs/protobuf/protobuf-input-001/poc/poc_real.cpp \
  $(cat builds/protobuf-asan-arm64/link_flags.txt) \
  builds/protobuf-asan-arm64/lib/libupb.a \
  -o bugs/protobuf/protobuf-input-001/poc/poc_real
```

**Evidence:**
- ASan Output: `bugs/protobuf/protobuf-input-001/validation/asan_output.txt`
- Exit Code: `0`
- Runtime Output:

```text
linked_libupb requested=4294967295 ptr=0x300004810 accounted=4294967712 fused=1
touch_first=65 touch_last=90
```

**Interpretation:**
- The prebuilt ASan bundle does not include the `conformance_upb` executable or `DoTestIo()` symbol, so exact end-to-end validation of the harness binary was not possible from the supplied artifacts.
- The real compiled `libupb.a` allocator path reached by `DoTestIo()` accepted a `0xffffffff` request, returned a non-NULL pointer, accounted roughly `4 GiB` of arena space, and allowed writes to the first and last bytes of that span.
- No AddressSanitizer memory-corruption error occurred, so this is not `CONFIRMED_MEMORY`.

**Conclusion:** The finding is validated as a resource-exhaustion / logic issue against the real compiled allocator path. Untrusted length data can drive a multi-gigabyte allocation request with no upper bound before parsing begins.
