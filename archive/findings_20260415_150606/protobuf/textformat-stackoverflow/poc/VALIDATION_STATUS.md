# VALIDATION_STATUS.md

## Finding: textformat-stackoverflow

**Status:** LOGIC_BUG

**Validated Against:**
- Library: `libprotobuf.a` (ASan build)
- Build: `builds/protobuf-asan-arm64/`
- Commit: `514aceb974fbd55031169b79d2bd9f7646157787`
- Date: `2026-04-15`

**Source Basis:**
- `src/google/protobuf/text_format.cc:3156-3159` recurses on `TYPE_GROUP`
  without stopping when the recursion budget is exhausted.

**Compilation:**
```bash
xcrun clang++ -arch arm64 $(cat builds/protobuf-asan-arm64/compile_flags.txt) \
  poc_real.cpp \
  $(cat builds/protobuf-asan-arm64/link_flags.txt) \
  /opt/homebrew/opt/abseil/lib/libabsl*.dylib -lz -lc++ -lm \
  -o poc_real
```

**Evidence:**
- PoC: `poc_real.cpp`
- Build script: `build_real.sh`
- ASan output: `asan_output.txt`
- LLDB/state-capture report: `../debugging/LLDB_DEBUG_REPORT.md`
- Trigger: `./poc_real 50000`
- Exit behavior: ASan abort after stack overflow
- Control state: depth `10` keeps `expected_budget_after_last_group=0`
- Bug state: depth `12` reaches `expected_budget_after_last_group=-2` and still
  prints all `12` nested groups with `print_ok=1`

**Stack Trace:**
1. `google::protobuf::TextFormat::Printer::TextGenerator::Write`
2. `google::protobuf::TextFormat::Printer::PrintUnknownFields`
3. `google::protobuf::TextFormat::Printer::PrintUnknownFields` repeated recursively

**Conclusion:** LLDB fallback state capture proves the core bug first: the
unknown-field recursion budget goes negative and `TYPE_GROUP` recursion still
continues successfully. That incorrect runtime state is a `LOGIC_BUG`, and the
large-depth ASan stack overflow is the memory-impact consequence of the same
flaw.
