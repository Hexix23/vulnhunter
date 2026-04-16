# VALIDATION_STATUS.md

## Finding: protobuf-input-003

**Status:** CONFIRMED_MEMORY

**Validated Against:**
- Library: `libupb.a` via `builds/protobuf-asan-arm64/`
- Build: `builds/protobuf-asan-arm64/`
- Commit: `4adbfee7e8fd2806b37d32ef954f41ba035bd39b`
- Date: `2026-04-15T19:20:00Z`

**Compilation:**
```bash
xcrun clang++ -arch arm64 $(cat builds/protobuf-asan-arm64/compile_flags.txt) \
  bugs/protobuf/protobuf-input-003/poc/poc_real.cpp \
  $(cat builds/protobuf-asan-arm64/link_flags.txt) \
  -o bugs/protobuf/protobuf-input-003/poc/poc_real
```

**Runtime Harness:**
- Source: `bugs/protobuf/protobuf-input-003/poc/poc_real.cpp`
- Entry point exercised: `upb_util_HasUnsetRequired(..., &fields)`
- Triggered real library path recording missing required-field paths in `required_fields.c`
- Trigger shape: recursive proto tree with `depth=11`, `breadth=4`

**Evidence:**
- ASan output: `bugs/protobuf/protobuf-input-003/validation/asan_output.txt`
- Compile command: `bugs/protobuf/protobuf-input-003/validation/compile.command.txt`
- Fresh recheck command: `ASAN_OPTIONS=detect_leaks=0:abort_on_error=0 bugs/protobuf/protobuf-input-003/poc/poc_real 11 4`
- Exit code: `1` on the fresh recheck

**Observed Behavior:**
- `sizeof(upb_FieldPathEntry) == 16`
- `INT_MAX / sizeof(upb_FieldPathEntry) == 134217727`
- ASan aborts in library code with `requested allocation size 0xffffffff80000000`
- Stack trace reaches:
  - `upb_FieldPathVector_Reserve()`
  - `upb_util_FindUnsetRequiredInternal()`
  - `upb_util_HasUnsetRequired()`
  - `main()` in `poc_real.cpp`

**Conclusion:**
The real ASan build reaches the narrowing bug in `upb_FieldPathVector_Reserve()`. Once the field-path vector capacity crosses the signed `int` boundary, the truncated `newsize` becomes negative and is passed to `upb_grealloc()` as the huge request `0xffffffff80000000`, which ASan aborts as `allocation-size-too-big`. This is a confirmed memory-management failure in the compiled library. The observed manifestation is allocator abort from signed wrap, not an undersized-buffer overwrite.
