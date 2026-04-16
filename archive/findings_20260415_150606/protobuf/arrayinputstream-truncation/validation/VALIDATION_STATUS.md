# VALIDATION_STATUS.md

## Finding: arrayinputstream-truncation

**Status:** LOGIC_BUG

**Validated Against:**
- Library: `libprotobuf.a` (pre-built ASan archive)
- Build: `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/builds/protobuf-asan-arm64`
- Commit: `b1405610a2f03798848b186125cd5a1378d12597`
- Date: `2026-04-15`

**Source Basis:**
- `ArrayInputStream` takes `int size`: `targets/protobuf/src/google/protobuf/io/zero_copy_stream_impl_lite.h`
- The constructor stores that value in `size_`, and `Next()` only returns bytes when `position_ < size_`: `targets/protobuf/src/google/protobuf/io/zero_copy_stream_impl_lite.cc`

**Compilation:**
```bash
xcrun clang++ -arch arm64 $(cat builds/protobuf-asan-arm64/compile_flags.txt) \
  bugs/protobuf/arrayinputstream-truncation/poc/poc_real.cpp \
  $(cat builds/protobuf-asan-arm64/link_flags.txt) \
  -labsl_cord -labsl_cord_internal -labsl_cordz_info -labsl_cordz_handle \
  -labsl_cordz_functions -labsl_cordz_sample_token \
  -o bugs/protobuf/arrayinputstream-truncation/poc/poc_real
```

**Evidence:**
- ASan Output: `bugs/protobuf/arrayinputstream-truncation/validation/asan_output.txt`
- Exit Code: `0`
- Runtime Output:
  - `logical_size=2147483648`
  - `int_truncated_size=-2147483648`
  - `next_result=0`
  - `returned_size=-1`
  - `byte_count=0`

**Conclusion:**
`ArrayInputStream` in the real compiled library does not trigger ASan memory corruption for this case. The issue is a confirmed logic bug: a logical input length of `2147483648` narrows to `-2147483648`, so `Next()` immediately returns EOF and the stream behaves as empty.
