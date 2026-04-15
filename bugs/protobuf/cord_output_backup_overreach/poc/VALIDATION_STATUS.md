# VALIDATION_STATUS.md

## Finding: cord_output_backup_overreach

**Status:** CONFIRMED_MEMORY

**Validated Against:**
- Library: `libprotobuf.a` (ASan build)
- Build: `builds/protobuf-asan-arm64/`
- Commit: `514aceb974fbd55031169b79d2bd9f7646157787`
- Date: `2026-04-15`

**Compilation:**
```bash
bash bugs/protobuf/cord_output_backup_overreach/poc/build_real.sh
```

**Execution:**
```bash
cd bugs/protobuf/cord_output_backup_overreach/poc
ASAN_SYMBOLIZER_PATH=/opt/homebrew/opt/llvm/bin/llvm-symbolizer \
ASAN_OPTIONS=detect_leaks=0:abort_on_error=0 \
./poc_real > asan_output.txt 2>&1
```

**Evidence:**
- ASan Output: `bugs/protobuf/cord_output_backup_overreach/poc/asan_output.txt`
- Exit Code: `1`
- Trigger: Call `CordOutputStream::BackUp()` with `count` greater than the most recent `Next()` size but still less than or equal to `ByteCount()`

**Stack Trace:**
1. `memcpy`
2. `google::protobuf::io::CordOutputStream::Consume()` at `zero_copy_stream_impl_lite.cc:689`
3. `main` in `poc_real.cpp:38`

**Source Notes:**
- `BackUp()` only checks `assert(count <= buffer_length)` before the unsafe branch in `zero_copy_stream_impl_lite.cc:665-673`.
- In the validated ASan build, that assertion did not prevent execution, and the code took the `else` branch:
  - `buffer_ = {};`
  - `cord_.RemoveSuffix(count);`
  - `state_ = State::kSteal;`
- A later `Consume()` appends the poisoned/moved-from buffer state and ASan reports `use-after-poison`.

**Conclusion:** The bug is confirmed against the real compiled protobuf library. Overreaching `CordOutputStream::BackUp()` causes memory-unsafe behavior in the shipped ASan build, with a reproducible AddressSanitizer `use-after-poison` in library code.
