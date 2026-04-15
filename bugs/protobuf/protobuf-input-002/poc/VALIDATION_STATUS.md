# VALIDATION_STATUS.md

## Finding: protobuf-input-002

**Status:** SOURCE_NOT_FOUND

**Validated Against:**
- Library: `libprotobuf.a`, `libupb.a` (ASan build)
- Build: `builds/protobuf-asan-arm64/`
- Commit: `514aceb974fbd55031169b79d2bd9f7646157787`
- Date: `2026-04-15`

**Compilation:**
```bash
bash /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/protobuf-input-002/poc/build_real.sh
```

**Execution:**
```bash
cd /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/protobuf-input-002/poc
ASAN_OPTIONS=detect_leaks=0:abort_on_error=0 ./poc_real > asan_output.txt 2>&1
```

**Evidence:**
- Build output: `poc/build_output.txt`
- Runtime output: `poc/asan_output.txt`
- Exit code: `0`
- Archive symbol probe: `validation/libupb_symbol_probe.txt`

**Why SOURCE_NOT_FOUND:**
- Source analysis still points to the inline `upb_String_Append()` helper in `targets/protobuf/upb/io/string.h`.
- The prebuilt archive in this workspace does not export the relevant `upb` tokenizer/string entry points (`upb_Tokenizer_New`, `upb_Parse_String`, `upb_String_Append`, `upb_String_Reserve`), so the originally reported path is not present in the compiled library being validated.
- A fresh PoC was compiled against the real ASan archive and exercised the tokenizer surface that is actually present in `libprotobuf.a` (`google::protobuf::io::Tokenizer::ParseStringAppend()` and `Tokenizer::Next()`), with no ASan or UBSan failure.

**Conclusion:** The reported source bug was not reproducible against the real compiled library in `builds/protobuf-asan-arm64/`. For this build snapshot, the correct revalidation outcome is `SOURCE_NOT_FOUND`.
