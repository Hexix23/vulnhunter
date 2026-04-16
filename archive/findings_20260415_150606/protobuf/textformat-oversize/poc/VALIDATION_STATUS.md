# VALIDATION_STATUS.md

## Finding: textformat-oversize

**Status:** NEEDS_INVESTIGATION

**Validated Against:**
- Library: `libprotobuf.a` (ASan build)
- Build: `builds/protobuf-asan-arm64/`
- Commit: `514aceb974fbd55031169b79d2bd9f7646157787`
- Date: `2026-04-15`

**Compilation:**
```bash
xcrun clang++ -arch arm64 -L/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/builds/protobuf-asan-arm64/lib \
  $(cat /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/builds/protobuf-asan-arm64/compile_flags.txt) \
  /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/textformat-oversize/poc/poc_real.cpp \
  /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/builds/protobuf-asan-arm64/lib/libprotobuf.a \
  $(pkg-config --libs protobuf | sed -E 's@-L[^ ]+/protobuf/[^ ]+ -lprotobuf ?@@') \
  -lpthread \
  -o /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/textformat-oversize/poc/poc_real
```

**Evidence:**
- ASan Output: `validation/asan_output.txt`
- Exit Code: `1`
- Runtime Output: none from the PoC itself; process aborts before `main()`

**Source Analysis:**
- `google/protobuf/text_format.cc` contains:
  `CheckParseInputSize(T& input, io::ErrorCollector* error_collector)`
- For `input.size() > INT_MAX`, it calls:
  `error_collector->RecordError(...)`
- `TextFormat::Parser::Parser()` initializes `error_collector_` to `nullptr`

**Observed Behavior Against Real Library:**
1. The fresh PoC uses a sparse `mmap()` of `INT_MAX + 1` bytes and calls `TextFormat::Parser::ParseFromString()` with the default null error collector.
2. The real compiled ASan binary aborts before `main()` during descriptor registration.
3. The observed stack trace is unrelated to the claimed bug path:
   `google::protobuf::DescriptorPool::Tables::Tables()`
   `google::protobuf::DescriptorPool::InternalAddGeneratedFile()`
   `google::protobuf::internal::AddDescriptors()`

**Conclusion:** The source-level bug is present, but this build cannot validate it because the supplied ASan library crashes earlier during protobuf static initialization. This finding is not confirmed against the real compiled library from the provided build artifacts.
