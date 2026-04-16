# Validation Status

## Finding: upb-decoder-reserve-overflow

**Status:** NO_CRASH

**Validated Against:**
- Library: `libupb.a` from the prebuilt ASan bundle
- Build: `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/builds/protobuf-asan-arm64`
- Date: 2026-04-15

**Source Analysis:**
- Candidate sink: `targets/protobuf/upb/wire/decode.c`
- Relevant path:
  - `_upb_Decoder_Reserve()` at line 105
  - `_upb_Decoder_DecodeFixedPacked()` at lines 277-318
- The hypothesis was an overflow in `arr->size + elem` during packed repeated-field decode.

**Fresh PoC:**
- `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/upb-decoder-reserve-overflow/poc/poc_real.cpp`
- The PoC builds a one-field packed `fixed32` mini-table with `upb_MtDataEncoder_*`, allocates a real `upb_Message`, and invokes `upb_Decode()` from the compiled ASan `libupb.a`.
- Runtime input: `2,097,152` packed `fixed32` elements (`8,388,613` bytes total payload).

**Compilation:**
```bash
bash bugs/protobuf/upb-decoder-reserve-overflow/poc/build_real.sh
```

**Execution:**
```bash
ASAN_OPTIONS=detect_leaks=0:abort_on_error=0 \
  bugs/protobuf/upb-decoder-reserve-overflow/poc/poc_real 2097152
```

**Evidence:**
- Output file: `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/upb-decoder-reserve-overflow/poc/asan_output.txt`
- Exit code: `0`
- Runtime output:
  - `payload_bytes=8388613 elem_count=2097152`
  - `decode_status=0 (Ok)`
  - `parsed_count=2097152 capacity=2097152`

**Conclusion:**
- No AddressSanitizer finding was produced when exercising the real packed repeated-field reserve path in the compiled library.
- The real library successfully decoded a large packed payload and produced the expected element count.
- Based on this revalidation, the finding is **not confirmed as a memory corruption bug** on the provided arm64 ASan build.
