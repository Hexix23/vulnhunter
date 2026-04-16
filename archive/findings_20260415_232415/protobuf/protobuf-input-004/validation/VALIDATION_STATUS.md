# VALIDATION_STATUS.md

## Finding: Descriptor scratch-buffer growth uses truncated pointer delta

**Status:** CONFIRMED_MEMORY

**Validated Against:**
- Library: prebuilt ASan `libupb.a` from `builds/protobuf-asan-arm64/`
- Build: `builds/protobuf-asan-arm64/`
- Commit: `4adbfee`
- Location under review: `targets/protobuf/upb/reflection/desc_state.c:15`
- Date: `2026-04-15T17:23:21Z`

**Environment:**
- OS: `Darwin`
- Host Arch: `arm64`
- Binary Arch: `arm64`
- Compiler that worked: `xcrun clang++ -arch arm64`

**Compilation Attempts:**
1. Homebrew `clang++` with bundled flags -> failed with `___asan_version_mismatch_check_apple_clang_2100`
2. Homebrew `clang++ -stdlib=libc++` -> failed with the same ASan mismatch
3. `xcrun clang++ -arch arm64` with bundled flags -> success

**Compilation:**
```bash
./build_real.sh
```

**Execution:**
```bash
ASAN_OPTIONS=detect_leaks=0:abort_on_error=0 ./poc_real
ASAN_OPTIONS=detect_leaks=0:abort_on_error=0 ./poc_real --attempt-write
```

**Evidence:**
- Build log: `compile_err.txt`
- Logic run log: `asan_output_logic.txt`
- Crash run log: `asan_output_write.txt`
- Combined log: `asan_output.txt`
- Exit codes: `exit_code_logic.txt` = `0`, `exit_code_write.txt` = `1`
- JSON result: `asan_result.json`
- Feedback: `state/current_run/validation_feedback.json`

**What Was Validated:**
- The harness links against the real compiled `libupb` and calls the exported `_upb_DescState_Grow()` symbol through installed internal headers from the prebuilt bundle.
- The harness places `d->ptr` at a logical distance of `2147483679` bytes from `d->buf`, which truncates to `-2147483617` when `_upb_DescState_Grow()` computes `const int used = d->ptr - d->buf`.
- In that state, `_upb_DescState_Grow()` returned success and skipped reallocation even though the logical used byte count already exceeded the 64-byte buffer and the encoder still required `kUpb_MtDataEncoder_MinSize` more bytes.

**Runtime Evidence:**
```text
logical_used_64=2147483679
truncated_used_32=-2147483617
old_bufsize=64
grow_returned=true
buf_changed=false
ptr_changed=false
bufsize_after=64
expected_realloc=true
skipped_realloc=true
```

**ASan Crash Evidence:**
```text
attempting_follow_on_library_write=true
AddressSanitizer:DEADLYSIGNAL
==99888==ERROR: AddressSanitizer: BUS on unknown address
    #0 upb_MtDataEncoder_PutRaw
    #1 upb_MtDataEncoder_StartMessage
    #2 main
SUMMARY: AddressSanitizer: BUS in upb_MtDataEncoder_PutRaw
```

**Interpretation:**
- This confirms the signed truncation in the real compiled library and demonstrates the memory-corruption consequence once the descriptor scratch state crosses the `INT_MAX` boundary described by the finding.
- The crash is produced from a crafted internal `upb_DescState`, not from an end-to-end public schema parser input in this environment. That means exploitability through normal public APIs still depends on whether attacker-controlled descriptor complexity can actually drive the scratch buffer past `INT_MAX` bytes in practice.

**Conclusion:** The finding is validated as `CONFIRMED_MEMORY` against the real compiled `libupb`: once `d->ptr - d->buf` exceeds `INT_MAX`, `_upb_DescState_Grow()` can skip a required growth due to `int` truncation, and the next encoder write crashes in library code under ASan.
