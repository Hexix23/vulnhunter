# VALIDATION_STATUS.md

## Finding: tokenizer_fini_null

**Status:** LOGIC_BUG

**Validated Against:**
- Library: libprotobuf.a (ASan build)
- Build: `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/builds/protobuf-asan-arm64`
- Date: 2026-04-15

**Source Analysis:**
- `src/google/protobuf/io/tokenizer.cc:181` stores `input` directly in `input_` and calls `Refresh()`.
- `src/google/protobuf/io/tokenizer.cc:237` dereferences `input_` via `input_->Next(...)` with no null check.
- `src/google/protobuf/io/tokenizer.cc:209` dereferences `input_` in `~Tokenizer()` via `input_->BackUp(...)` with no null check if unread data remains.

**Evidence:**
- Fresh PoC: `poc/poc_real.cpp`
- Build script: `poc/build_real.sh`
- Runtime output: `validation/asan_output.txt`
- Observed result: `AddressSanitizer: SEGV on unknown address 0x000000000000`

**Runtime Summary:**
- The fresh PoC links directly against `builds/protobuf-asan-arm64/lib/libprotobuf.a`.
- Executing `Tokenizer(nullptr, nullptr)` crashes immediately in `google::protobuf::io::Tokenizer::Tokenizer(...)`.
- The trace shows a null read from the zero page during constructor-time initialization.

**Conclusion:**
- The compiled audit library reproduces a null-pointer dereference on invalid public API input.
- This is not a confirmed heap corruption / out-of-bounds / use-after-free finding, so it is recorded as `LOGIC_BUG`, not `CONFIRMED_MEMORY`.
