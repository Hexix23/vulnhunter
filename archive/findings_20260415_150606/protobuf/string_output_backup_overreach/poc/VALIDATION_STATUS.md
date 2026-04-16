# VALIDATION_STATUS.md

## Finding: string_output_backup_overreach

**Status:** LOGIC_BUG

**Validated Against:**
- Library: libprotobuf.a (ASan build)
- Build: builds/protobuf-asan-arm64/
- Commit: b1405610a2f03798848b186125cd5a1378d12597
- Date: 2026-04-15

**Compilation:**
```bash
xcrun clang++ -arch arm64 $(cat /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/builds/protobuf-asan-arm64/compile_flags.txt) poc_real.cpp \
  $(cat /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/builds/protobuf-asan-arm64/link_flags.txt) \
  -labsl_cord -labsl_cord_internal -labsl_cordz_info -labsl_cordz_functions \
  -labsl_cordz_handle -labsl_cordz_sample_token -labsl_crc_cord_state \
  -labsl_crc32c -labsl_graphcycles_internal -labsl_synchronization -o poc_real
```

**Evidence:**
- ASan Output: asan_output.txt
- Exit Code: 0
- Runtime Output:
  - `second_size=32`
  - `overreach_request=40`
  - `size_before_overreach=71`
  - `size_after_overreach=31`
  - `prefix_after_overreach="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"`

**Conclusion:** Confirmed logic flaw in the real compiled library. `google::protobuf::io::StringOutputStream::BackUp()` accepts a count larger than the last `Next()` span and silently retracts 8 bytes from a previously committed buffer. The fresh PoC produced no AddressSanitizer memory-corruption report, so this finding is validated as `LOGIC_BUG`, not `CONFIRMED_MEMORY`.
