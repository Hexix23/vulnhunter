# VALIDATION_STATUS.md

## Finding: tokenizer_error_swallow

**Status:** LOGIC_BUG

**Validated Against:**
- Library: `libprotobuf.a` (ASan build)
- Build: `builds/protobuf-asan-arm64/`
- Date: 2026-04-15

**Compilation:**
```bash
bash /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/tokenizer_error_swallow/poc/build_real.sh
```

**Execution:**
```bash
cd /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/tokenizer_error_swallow/poc
ASAN_OPTIONS=detect_leaks=0:abort_on_error=0 ./poc_real 2>&1 | tee asan_output.txt
```

**Evidence:**
- `tokenizer_next=0`
- `tokenizer_stream_failed=1`
- `tokenizer_error_count=0`
- `parser_ok=1`
- `parser_stream_failed=1`
- `error_count=0`
- `RESULT=LOGIC_BUG`

**Runtime Evidence:**
- `Tokenizer::Refresh()` treats `ZeroCopyInputStream::Next() == false` as EOF and sets `read_error_` without calling `ErrorCollector::RecordError()`.
- The direct tokenizer probe returns `false` with no recorded tokenizer errors even though the stream reports failure.
- `google::protobuf::compiler::Parser::Parse()` then accepts that failed stream as an empty file and returns success, also with no collector errors.

**Conclusion:** Confirmed as a real compiled-library logic bug, not a memory corruption issue. The failure mode is silent input-read error swallowing rather than an ASan-detectable memory safety defect.

**ASan Result:** No sanitizer crash observed.
