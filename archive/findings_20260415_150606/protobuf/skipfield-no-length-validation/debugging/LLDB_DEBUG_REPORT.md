# LLDB Debug Report: skipfield-no-length-validation

## Build Information

- Build directory: `builds/protobuf-asan-arm64`
- Debug binary: `bugs/protobuf/skipfield-no-length-validation/debugging/poc_debug`
- Instrumented source: `bugs/protobuf/skipfield-no-length-validation/debugging/state_capture.cpp`
- PoC source: `bugs/protobuf/skipfield-no-length-validation/poc/poc_real.cpp`

Compile command used:

```bash
PKGCONFIG_ABSL_LIBS="$(pkg-config --libs --static \
  absl_log absl_cord absl_statusor absl_flat_hash_map absl_flat_hash_set \
  absl_raw_hash_set absl_hashtable_control_bytes absl_container_common \
  absl_hash absl_synchronization absl_time absl_strings absl_str_format \
  absl_status)"

xcrun clang++ -arch arm64 $(cat builds/protobuf-asan-arm64/compile_flags.txt) -g \
  bugs/protobuf/skipfield-no-length-validation/debugging/state_capture.cpp \
  $(cat builds/protobuf-asan-arm64/link_flags.txt) \
  $PKGCONFIG_ABSL_LIBS -lz -lc++ -lm \
  -o bugs/protobuf/skipfield-no-length-validation/debugging/poc_debug
```

## Executive Summary

The malformed unknown length-delimited field does not produce an incorrect parser state in this build.
`WireFormatLite::SkipField()` decodes the varint length as `2147483632 (0x7ffffff0)`, which is still a positive signed `int`.
`CodedInputStream::Skip(length)` then rejects the request cleanly because only three payload bytes remain.
No negative size, integer wrap, corrupted limit, or limit bypass was observed.

## Vulnerable Path Under Test

Relevant source lines from the checked-out protobuf source:

```cpp
// google/protobuf/wire_format_lite.cc:130-134
case WireFormatLite::WIRETYPE_LENGTH_DELIMITED: {
  uint32_t length;
  if (!input->ReadVarint32(&length)) return false;
  if (!input->Skip(length)) return false;
  return true;
}
```

```cpp
// google/protobuf/io/coded_stream.h:1662-1673
inline bool CodedInputStream::Skip(int count) {
  if (count < 0) return false;
  const int original_buffer_size = BufferSize();
  if (count <= original_buffer_size) {
    Advance(count);
    return true;
  }
  return SkipFallback(count, original_buffer_size);
}
```

```cpp
// google/protobuf/io/coded_stream.cc:210-225
int bytes_until_limit = closest_limit - total_bytes_read_;
if (bytes_until_limit < count) {
  if (bytes_until_limit > 0) {
    total_bytes_read_ = closest_limit;
    (void)input_->Skip(bytes_until_limit);
  }
  return false;
}
if (!input_->Skip(count)) {
  total_bytes_read_ = input_->ByteCount();
  return false;
}
```

## Debugger Attempt Chain

### 1. LLDB

Attempted with `debugging/lldb_commands.txt` after codesigning `poc_debug`.
LLDB could create the target but could not launch it:

```text
(lldb) run
error: could not find 'debugserver'. Please ensure it is properly installed and available in your PATH
```

### 2. LLDB with explicit architecture

Attempted with `lldb --arch arm64 ...` and failed identically:

```text
(lldb) run
error: could not find 'debugserver'. Please ensure it is properly installed and available in your PATH
```

### 3. GDB fallback

GDB was available but could not consume the generated DWARF for this binary:

```text
DW_FORM_GNU_str_index or DW_FORM_strx used without .debug_str section
```

### 4. Final fallback: instrumented state capture

Because both debuggers were blocked by host tooling, runtime state was captured with the instrumented debug PoC.

## Step-by-Step Evidence

### 1. Payload and decoded length

Observed output:

```text
payload_size=10
payload_bytes: da 07 f0 ff ff ff 07 41 42 43
[DECODE] tag=0x3da
[DECODE] read_length_ok=1
[DECODE] decoded_length=2147483632 (0x7ffffff0)
[DECODE] decoded_length_as_int=2147483632
```

Interpretation:

- Tag `0x3da` is field `123`, wire type `2` (length-delimited).
- The encoded length is large but still positive after conversion to `int`.
- This does not demonstrate the negative-size or signed-overflow pattern expected for a state bug.

### 2. Stream state after manually decoding tag and length

Observed output:

```text
[STATE] after manual tag+length decode
  CurrentPosition()=7
  BytesUntilLimit()=-1
  BufferSize()=3
  current_limit_=2147483647
  buffer_size_after_limit_=0
  total_bytes_limit_=2147483647
  total_bytes_read_=10
  next_bytes: 41 42 43
```

Interpretation:

- Only the three real payload bytes remain.
- `BytesUntilLimit() = -1` here means no pushed sub-limit is active.
- `current_limit_` remains the default maximum and is not corrupted.

### 3. Stream state right before `SkipField()`

Observed output:

```text
[STATE] after ReadTag before SkipField
  CurrentPosition()=2
  BytesUntilLimit()=-1
  BufferSize()=8
  current_limit_=2147483647
  buffer_size_after_limit_=0
  total_bytes_limit_=2147483647
  total_bytes_read_=10
  next_bytes: f0 ff ff ff 07 41 42 43
```

Interpretation:

- The stream is positioned exactly where `SkipField()` will read the varint length.
- Internal limit bookkeeping remains sane before the call.

### 4. Result after `SkipField()`

Observed output:

```text
[SKIPFIELD] skip_ok=0
[STATE] after SkipField
  CurrentPosition()=10
  BytesUntilLimit()=-1
  BufferSize()=0
  current_limit_=2147483647
  buffer_size_after_limit_=0
  total_bytes_limit_=2147483647
  total_bytes_read_=10
  buffer_ptr=0x0
  buffer_end=0x0
```

Interpretation:

- `SkipField()` returned `false`, which is the expected safe failure path.
- The parser consumed the available input and ended at EOF.
- No internal limit field changed to an invalid value.

## Summary Table

| Check | Expected for state bug | Actual | Result |
|-------|------------------------|--------|--------|
| Decoded length as signed `int` | Negative or wrapped | `2147483632` | OK |
| `current_limit_` | Corrupted or reduced incorrectly | `2147483647` | OK |
| `BytesUntilLimit()` | Unexpected negative due to bypass | `-1` with no active sub-limit | OK |
| `SkipField()` return | Incorrect success or bad state | `false` | OK |

## Conclusion

This finding did not reproduce a logic/state bug in the tested protobuf build.
The malformed length-delimited field is rejected safely:

- length stays positive
- `SkipField()` fails closed
- limit bookkeeping remains unchanged
- no limit bypass or negative count is observed

Final result: `STATE_OK`
