# Validation Status

## Finding: readbytestostring-no-size-cap

Status: LOGIC_BUG

Validated Against:
- Library: `builds/protobuf-asan-arm64/lib/libprotobuf.a`
- ASan PoC: `bugs/protobuf/readbytestostring-no-size-cap/poc/poc_real.cpp`
- Debug fallback PoC: `bugs/protobuf/readbytestostring-no-size-cap/debugging/poc_state_capture.cpp`
- Date: 2026-04-15

ASan result:
- No AddressSanitizer crash or memory corruption was reproduced.

Runtime evidence:
- `ReadBytesToString()` decodes oversized lengths as `uint32_t` and forwards them directly to `ReadString(std::string*, int)`.
- For `0x80000000`, runtime capture shows `decoded_length_u32=2147483648` and `decoded_length_i32=-2147483648`.
- For `0xffffffff`, runtime capture shows `decoded_length_u32=4294967295` and `decoded_length_i32=-1`.
- `ReadString()` then returns `false` without advancing `CurrentPosition()` or changing `BytesUntilLimit()`, so the stream state is not corrupted in this path.

Source correlation:
- `src/google/protobuf/wire_format_lite.cc:547-548` reads `uint32_t length` and calls `input->ReadString(value, length)`.
- `src/google/protobuf/io/coded_stream.cc:261-262` rejects negative signed sizes with `if (size < 0) return false;`.

Conclusion:
This is a logic/state bug, not a demonstrated memory-safety bug in the tested build. The missing local size cap allows oversized wire lengths to narrow into negative signed sizes at the `ReadString()` boundary, but downstream checks prevent an out-of-bounds read or write in this reproduction.
