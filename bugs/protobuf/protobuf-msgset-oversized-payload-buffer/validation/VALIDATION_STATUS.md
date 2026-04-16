# VALIDATION_STATUS.md

## Finding: protobuf-msgset-oversized-payload-buffer

**Status:** LOGIC_BUG

**Validated Against:**
- Target: protobuf
- Build: `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/builds/protobuf-asan-arm64`
- Commit: `4adbfee7e8fd2806b37d32ef954f41ba035bd39b`
- Date: `2026-04-15T23:09:42Z`
- Platform: `Darwin arm64`

**Compilation:**
```bash
xcrun clang++ $(cat builds/protobuf-asan-arm64/compile_flags.txt) \
  bugs/protobuf/protobuf-msgset-oversized-payload-buffer/poc/poc_real.cpp \
  $(cat builds/protobuf-asan-arm64/link_flags.txt) \
  -o bugs/protobuf/protobuf-msgset-oversized-payload-buffer/poc/poc_real
```

**Execution:**
```bash
ASAN_OPTIONS=detect_leaks=0 \
  bugs/protobuf/protobuf-msgset-oversized-payload-buffer/poc/poc_real \
  > bugs/protobuf/protobuf-msgset-oversized-payload-buffer/validation/asan_output.txt 2>&1
```

**Evidence:**
- Output file: `bugs/protobuf/protobuf-msgset-oversized-payload-buffer/validation/asan_output.txt`
- Exit code: `1`
- Runtime trace shows:
  - A 7-byte MessageSet item was constructed with field 3 before field 2.
  - The claimed payload length was `4294967280`.
  - `ParseMessageSetItemImpl` was entered on the staged protobuf headers and returned `false`.

**What was validated:**
- The vulnerable implementation is inline in the shipped protobuf header at `google/protobuf/wire_format_lite.h`, so the PoC exercised the exact parser logic from the staged build headers, linked against the real ASan protobuf runtime.
- The wire payload was `0b 1a f0 ff ff ff 0f`, which is:
  - start-group tag for a MessageSet item
  - message-bytes tag
  - varint length `0xfffffff0`
- This input reaches the `state == kNoTag` branch described in the finding, where the code computes `length + VarintSize32(length)` and resizes the temporary string before any `ReadRaw()` availability check can fail.

**Attempts and outcomes:**
1. Dynamic descriptor PoC with a runtime-built MessageSet schema.
   Result: aborted in an unrelated Abseil `raw_hash_set.h` assertion before parsing.
2. Generated-pool lookup for `google.protobuf.bridge.MessageSet`.
   Result: aborted in the same unrelated Abseil assertion during descriptor lookup.
3. Direct inline `ParseMessageSetItemImpl` harness from staged headers.
   Result: cleanly reached the vulnerable parser path and reproduced the oversized-length acceptance behavior.
4. Additional attempts to force a deterministic allocation failure via `setrlimit()` and guarded `operator new`.
   Result: no effect in this environment; the host accepted the oversized resize path far enough for the parser to simply return `false`.

**Conclusion:**
This finding is **confirmed as a LOGIC_BUG**. The real staged protobuf parser accepts an attacker-controlled near-4 GiB MessageSet payload length in the reverse-tag-order path and only fails later, after traversing the oversized temporary-buffer path. I did **not** observe an ASan memory-corruption crash on this host, so this is not `CONFIRMED_MEMORY`.
