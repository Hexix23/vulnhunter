# VALIDATION_STATUS.md

## Finding: cord_input_negative_skip

**Status:** LOGIC_BUG

**Validated Against:**
- Library: libprotobuf.a
- Build: builds/protobuf-asan-arm64/
- Date: 2026-04-15

**Source Analysis:**
- `google/protobuf/io/zero_copy_stream_impl_lite.cc`: `CordInputStream::Skip(int count)` lacks a negative-count guard.
- `google/protobuf/io/coded_stream.h`: `CodedInputStream::Skip(int count)` explicitly returns `false` for `count < 0`, which highlights the inconsistency.
- In `CordInputStream::Skip(-1)`, `count` is cast to `size_t`, both boundary checks fail, and `NextChunk(bytes_remaining_)` advances to EOF while returning `false`.

**Compilation:**
```bash
./build_real.sh
```

**Evidence:**
- Runtime output: `asan_output.txt`
- Result JSON: `../validation/asan_result.json`
- Observed output:
```text
cord_size=16
byte_count_before=0
skip_return=0
byte_count_after=16
next_after_skip=0
next_size=-1
```

**Conclusion:** Negative `CordInputStream::Skip()` does not crash under ASan, but it consumes the remaining `Cord` and leaves the stream at EOF. That is a confirmed logic bug in the real compiled library.
