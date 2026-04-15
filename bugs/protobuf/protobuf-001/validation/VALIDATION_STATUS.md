# VALIDATION_STATUS.md

## Finding: protobuf-001

**Status:** LOGIC_BUG

**Validated Against:**
- Library: `libprotobuf.a` (prebuilt ASan archive)
- Build: `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/builds/protobuf-asan-arm64`
- Date: 2026-04-15

**Source Analysis:**
- Located a concrete oversized-input path in `targets/protobuf/src/google/protobuf/json/internal/parser.cc`.
- `ParseAny()` buffers the entire JSON object with `BeginMark()`, then reparses `mark.value.UpToUnread()` through a second `JsonLexer`.
- There is no object-size guard before the reparse path, so large `google.protobuf.Any` JSON inputs are accepted into a fully buffered parse flow.

**Fresh PoC:**
- `poc/poc_real.cpp` builds a ~50 MiB `google.protobuf.Any` JSON object with `@type = google.protobuf.FileDescriptorSet`.
- The PoC targets the public `google::protobuf::json::JsonStringToMessage()` API and links against the real prebuilt `libprotobuf.a`.

**Compilation:**
```bash
xcrun clang++ -arch arm64 $(cat builds/protobuf-asan-arm64/compile_flags.txt) \
  bugs/protobuf/protobuf-001/poc/poc_real.cpp \
  -Lbuilds/protobuf-asan-arm64/lib \
  builds/protobuf-asan-arm64/lib/libprotobuf.a \
  builds/protobuf-asan-arm64/lib/libutf8_validity.a \
  /opt/homebrew/opt/abseil/lib/libabsl_*.dylib \
  -lpthread -lc++ -lz -framework CoreFoundation \
  -o bugs/protobuf/protobuf-001/poc/poc_real.retry
```

**Execution Result:**
- Fresh PoC exit code: `1`
- ASan output saved to `validation/asan_output.txt`
- The crash occurs before `main()`, during protobuf descriptor registration:
  - `google::protobuf::DescriptorPool::Tables::Tables()`
  - `google::protobuf::DescriptorPool::InternalAddGeneratedFile(void const*, int)`
  - `google::protobuf::internal::AddDescriptors(...)`

**Control Runs:**
- A descriptor-only control binary (`FileDescriptorSet` only) exits cleanly with code `0`.
- An `Any` + JSON API control binary with no oversized payload reproduces the same pre-`main()` ASan SEGV.

**Conclusion:**
- The real compiled library does **not** yield a usable finding-specific ASan trace for this PoC.
- The located issue is still a logic/resource-consumption bug in `ParseAny()` because the source path buffers and reparses the full object without a size cap.
- This validation is **not** a confirmed memory-corruption bug. The current ASan artifact for the `Any`/JSON path is blocked by an initialization-time crash unrelated to the oversized payload itself.
