# VALIDATION_STATUS.md

## Finding: parse_string_oom

**Status:** NO_CRASH

**Validated Against:**
- Library: `libprotobuf.a` (ASan build)
- Build: `builds/protobuf-asan-arm64/`
- Commit: `514aceb97`
- Date: `2026-04-15`

**Source Analysis:**
- `targets/protobuf/src/google/protobuf/parse_context.cc` caps eager reservation with `kSafeStringSize`.
- `targets/protobuf/src/google/protobuf/io/coded_stream_unittest.cc` already contains `ReadStringImpossiblyLarge*` regression tests expecting safe failure.

**Compilation:**
```bash
./bugs/protobuf/parse_string_oom/poc/build_real.sh
```

The provided `link_flags.txt` was insufficient for this static archive and required an Apple clang fallback plus additional Abseil dylibs.

**Evidence:**
- PoC: `bugs/protobuf/parse_string_oom/poc/poc_real.cpp`
- Build script: `bugs/protobuf/parse_string_oom/poc/build_real.sh`
- Runtime output: `bugs/protobuf/parse_string_oom/poc/asan_output.txt`
- Exit code: `1`

**Observed Runtime Behavior:**
- The process aborts before `main()` during descriptor registration.
- Stack starts in `google::protobuf::DescriptorPool::Tables::Tables()` and `InternalAddGeneratedFile()`.
- No frame reaches the claimed target path (`ReadString`, `InlineGreedyStringParser`, or `parse_context` string parsing).

**Conclusion:** The reported `parse_string_oom` finding is not confirmed against the supplied compiled library. Source analysis indicates the oversized-string case is handled defensively, and the only runtime failure observed is an initialization-time crash unrelated to the PoC payload.
