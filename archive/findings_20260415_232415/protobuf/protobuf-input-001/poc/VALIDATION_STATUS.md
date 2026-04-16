# VALIDATION_STATUS.md

## Finding: protobuf-input-001

**Status:** LOGIC_BUG

**Validated Against:**
- Library: `libupb.a` from `builds/protobuf-asan-arm64/`
- Build: `builds/protobuf-asan-arm64/`
- Commit: `4adbfee7e8fd2806b37d32ef954f41ba035bd39b`
- Date: `2026-04-15`

**Compilation:**
```bash
/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/protobuf-input-001/poc/build_real.sh
```

**Execution:**
```bash
ASAN_OPTIONS=detect_leaks=0:abort_on_error=0 \
  /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/protobuf-input-001/poc/poc_real \
  2>&1 | tee \
  /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/protobuf-input-001/poc/asan_output.txt
```

**Evidence:**
- Attempt 1 with `/opt/homebrew/opt/llvm/bin/clang++` failed due to ASan runtime mismatch:
  `___asan_version_mismatch_check_apple_clang_2100`.
- Attempt 4 with `xcrun clang++ -arch arm64` succeeded and linked against the prebuilt archive.
- LLDB resolved breakpoints but could not launch in this environment:
  `error: process exited with status -1 (no such process)`.
- Printf-based state capture against the shipped `libupb.a` path succeeded and
  produced:
  - `[SETUP] advertised input_size = 4294967295 (0xffffffff)`
  - `[AFTER] ptr = 0x300004810`
  - `[AFTER] accounted = 4294967712 (0x1000001a0)`
  - `[TOUCH] last byte  @ 0x40000480e = 0x5a`
- Exit code: `0`
- State capture output file:
  `bugs/protobuf/protobuf-input-001/debugging/printf_output.txt`
- No AddressSanitizer report was emitted.

**Limitation:**
- The finding's real sink is `DoTestIo()` in `targets/protobuf/upb/conformance/conformance_upb.c`.
- The supplied prebuilt ASan bundle does not include the `conformance_upb` executable or a `DoTestIo` symbol.
- macOS debugger launch was blocked in this environment, so state evidence was
  captured with an instrumented fallback PoC instead of live LLDB stepping.
- Per validation rules, the sink cannot be recompiled from source for
  confirmation, so only the linked `libupb.a` path could be exercised.

**Conclusion:**
- The real compiled library probe still does not show memory corruption, so this
  is not `CONFIRMED_MEMORY`.
- The runtime state evidence does prove the logic flaw: an untrusted 32-bit
  length directly drives a writable multi-gigabyte arena allocation with no
  upper bound before parsing begins.
- This finding is therefore validated as **LOGIC_BUG**.
