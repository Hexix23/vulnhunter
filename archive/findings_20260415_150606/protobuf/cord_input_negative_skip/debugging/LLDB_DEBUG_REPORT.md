# LLDB Debug Report: cord_input_negative_skip

## Build Information

- Build directory: `builds/protobuf-asan-arm64`
- Debug binary: `bugs/protobuf/cord_input_negative_skip/debugging/poc_debug`
- Fallback state harness: `bugs/protobuf/cord_input_negative_skip/debugging/state_capture`
- Target source: `targets/protobuf/src/google/protobuf/io/zero_copy_stream_impl_lite.cc:531-546`

## Executive Summary

`google::protobuf::io::CordInputStream::Skip(int count)` does not reject a negative `count`.
For `count = -1`, the code widens the value to `size_t`, so both bounds checks fail and the function falls through to `NextChunk(bytes_remaining_)`.
That consumes the entire Cord, sets the stream to EOF, and returns `false`.

## Debugger Attempt

LLDB batch execution was prepared with `lldb_commands.txt`, but this host cannot launch a local target because `debugserver` is not installed.

Attempted command:

```bash
lldb -b -s bugs/protobuf/cord_input_negative_skip/debugging/lldb_commands.txt \
  bugs/protobuf/cord_input_negative_skip/debugging/poc_debug
```

Observed failure:

```text
error: could not find 'debugserver'. Please ensure it is properly installed and available in your PATH
```

`xcrun lldb --arch arm64` was also tried and failed to launch the process. `gdb` is not available on this host.

## Fallback State Capture Evidence

The same prebuilt `libprotobuf.a` was exercised with a debug harness that exposes `CordInputStream` internals from the public header only.
No library rebuild was performed.

Compile command:

```bash
xcrun clang++ -arch arm64 -stdlib=libc++ $(cat builds/protobuf-asan-arm64/compile_flags.txt) -g \
  bugs/protobuf/cord_input_negative_skip/debugging/state_capture.cpp \
  $(cat builds/protobuf-asan-arm64/link_flags.txt) \
  -labsl_cord -labsl_cord_internal -labsl_cordz_functions -labsl_cordz_handle \
  -labsl_cordz_info -labsl_cordz_sample_token -lz -lm -lc++ \
  -o bugs/protobuf/cord_input_negative_skip/debugging/state_capture
```

Runtime output:

```text
cord_size=16
skip_count=-1
skip_count_as_size_t=18446744073709551615
within_available_before=0
within_remaining_before=0
[before_skip]
  size_=16
  available_=16
  bytes_remaining_=16
  byte_count=0
  data_ptr=0x102364040
  first_bytes=0x66 0x69 0x72 0x73 0x74 0x73 0x65 0x63
[after_skip]
  size_=0
  available_=0
  bytes_remaining_=0
  byte_count=16
  data_ptr=0x102364040
  first_bytes=<none>
skip_return=0
next_after_skip=0
next_size=-1
next_data=0
```

## Step-by-Step Evidence

### 1. Entry state before `Skip(-1)`

- `size_ = 16`
- `available_ = 16`
- `bytes_remaining_ = 16`
- `ByteCount() = 0`
- `data_` points at the Cord payload, whose first bytes are `66 69 72 73 74 73 65 63` (`"firstsec"`)

This is the expected initial state for a 16-byte Cord.

### 2. Signed-to-unsigned conversion

- `skip_count = -1`
- `skip_count_as_size_t = 18446744073709551615`
- `within_available_before = 0`
- `within_remaining_before = 0`

This proves the exact bug condition: a negative caller input becomes a huge unsigned value.
Because of that conversion, both checks in `Skip()` fail:

```cpp
if (static_cast<size_t>(count) <= available_) { ... }
if (static_cast<size_t>(count) <= bytes_remaining_) { ... }
```

### 3. Post-state after the real library call

- `skip_return = 0`
- `size_ = 0`
- `available_ = 0`
- `bytes_remaining_ = 0`
- `ByteCount() = 16`

That state matches the `NextChunk(bytes_remaining_)` fallback path:

```cpp
NextChunk(bytes_remaining_);
return false;
```

The function reports failure, but it has already consumed the entire Cord and moved the stream to EOF.

### 4. EOF confirmation

- `next_after_skip = 0`
- `next_size = -1`
- `next_data = 0`

The next read sees EOF immediately.
This confirms that `Skip(-1)` was not a harmless rejected input; it mutated the stream state by consuming all remaining data.

## Summary Table

| Check | Expected | Actual | Result |
|---|---|---|---|
| Negative skip rejected without state change | `ByteCount() = 0`, `bytes_remaining_ = 16` | `ByteCount() = 16`, `bytes_remaining_ = 0` | BUG |
| `count` used as signed negative | `-1` stays invalid | widened to `18446744073709551615` | BUG |
| Next read after failed skip | original payload still readable | immediate EOF | BUG |

## Conclusion

This finding is a real state bug in the shipped protobuf library.
`CordInputStream::Skip(-1)` returns `false`, but only after consuming the entire input Cord and leaving the stream at EOF.
The incorrect state transition is proven even without a live LLDB session.
