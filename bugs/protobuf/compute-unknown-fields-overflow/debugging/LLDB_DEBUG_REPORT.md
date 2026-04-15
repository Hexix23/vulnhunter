# LLDB Debug Report: compute-unknown-fields-overflow

## Build Information

- Build directory: `builds/protobuf-asan-arm64`
- PoC source: `bugs/protobuf/compute-unknown-fields-overflow/poc/poc_real.cpp`
- Debug binary: `bugs/protobuf/compute-unknown-fields-overflow/debugging/poc_debug`
- State-capture binary: `bugs/protobuf/compute-unknown-fields-overflow/debugging/poc_state_capture`
- Target code path: `targets/protobuf/src/google/protobuf/wire_format.h:160-164`
- Runtime sink: `targets/protobuf/src/google/protobuf/io/coded_stream.h:694-700`
- Host arch: `arm64`
- Rosetta translation: not detected
- Evidence refreshed: `2026-04-15`

## Executive Summary

`WireFormat::ComputeUnknownFieldsSize()` returns the correct unsigned size for one length-delimited unknown field with payload `INT_MAX + 256`: `2147483909`.

The bug appears immediately in `WireFormat::SerializeUnknownFieldsToArray()` at `wire_format.h:161`, where that unsigned value is narrowed with `static_cast<int>(...)` when constructing the stack-local `EpsCopyOutputStream stream`. The runtime state becomes `-2147483387` instead of a positive capacity. The payload length `2147483903` is also later narrowed to signed `int` as `-2147483393`. That incorrect state reaches `WriteRaw(const void* data, int size, uint8_t* ptr)` and ASan reports a real `stack-buffer-overflow` that overruns the local `stream` object.

## Debugger Attempts

### 1. LLDB batch run

Saved in `bugs/protobuf/compute-unknown-fields-overflow/debugging/lldb_output.txt`:

```text
(lldb) breakpoint set --file wire_format.h --line 161
Breakpoint 1: 2 locations.
(lldb) breakpoint set --file coded_stream.cc --line 1013
Breakpoint 2: where = poc_debug`google::protobuf::io::EpsCopyOutputStream::WriteStringOutline(...) + 208 at coded_stream.cc:1013:3
(lldb) breakpoint set --file coded_stream.h --line 694
Breakpoint 3: 25 locations.
(lldb) run
error: could not find 'debugserver'. Please ensure it is properly installed and available in your PATH
```

LLDB resolves the intended protobuf breakpoints, but the host cannot launch the inferior because `debugserver` is unavailable.

### 2. LLDB retry with explicit architecture

Saved in `bugs/protobuf/compute-unknown-fields-overflow/debugging/lldb_output_retry.txt`:

```text
(lldb) target create --arch=arm64 "./poc_debug"
...
(lldb) run
error: could not find 'debugserver'. Please ensure it is properly installed and available in your PATH
```

The explicit-architecture retry fails for the same reason.

### 3. GDB fallback

Saved in `bugs/protobuf/compute-unknown-fields-overflow/debugging/gdb_output.txt`:

```text
DW_FORM_GNU_str_index or DW_FORM_strx used without .debug_str section ...
bugs/protobuf/compute-unknown-fields-overflow/debugging/gdb_commands.txt:1: Error in sourced command file:
DW_FORM_GNU_str_index or DW_FORM_strx used without .debug_str section ...
```

GDB is installed, but it cannot parse the generated debug information, so it never reaches a usable stop.

## Step-by-Step State Evidence

### 1. Incorrect state before serialization

Saved in `bugs/protobuf/compute-unknown-fields-overflow/debugging/state_capture_output.txt`:

```text
[STATE] payload_size=2147483903
[STATE] INT_MAX=2147483647
[STATE] field_count=1
[STATE] tag_size=1
[STATE] length_prefix_size=5
[STATE] computed_size=2147483909
[STATE] stream_int_size=-2147483387
[STATE] computed_minus_stream_int=4294967296
[STATE] write_string_size=2147483903
[STATE] write_raw_signed_size=-2147483393
[STATE] write_raw_unsigned_size=2147483903
[STATE] predicted_end_minus_ptr_before_memcpy=-2147483393
[STATE] predicted_available_for_memcpy=2147483903
[STATE] memcpy_overflow_delta=0
```

Interpretation:

- `computed_size=2147483909` is mathematically correct.
- `stream_int_size=-2147483387` is the first wrong runtime state. The serializer capacity wrapped when narrowed to `int`.
- `computed_minus_stream_int=4294967296` proves a full 32-bit wraparound.
- `write_raw_signed_size=-2147483393` shows the payload length also becomes negative on the `int size` path.
- `predicted_end_minus_ptr_before_memcpy=-2147483393` proves the stream is already operating with a negative signed remaining capacity before the large copy starts.

### 2. Memory corruption when serialization executes

Saved in `bugs/protobuf/compute-unknown-fields-overflow/debugging/state_capture_crash_output.txt`:

```text
[STATE] target=0x380008000
[STATE] invoking SerializeUnknownFieldsToArray
==97179==ERROR: AddressSanitizer: stack-buffer-overflow on address 0x00016f505e40
WRITE of size 2147483903 at 0x00016f505e40 thread T0
    #1 google::protobuf::io::EpsCopyOutputStream::WriteStringOutline(...) coded_stream.cc:1013
    #2 google::protobuf::internal::WireFormat::InternalSerializeUnknownFieldsToArray(...) wire_format.cc:171
    #3 google::protobuf::internal::WireFormat::SerializeUnknownFieldsToArray(...) wire_format.h:164

Address 0x00016f505e40 is located in stack of thread T0 at offset 96 in frame
    #0 google::protobuf::internal::WireFormat::SerializeUnknownFieldsToArray(...) wire_format.h:160

  This frame has 1 object(s):
    [32, 96) 'stream' (line 161) <== Memory access at offset 96 overflows this variable
```

Interpretation:

- The negative signed state is not harmless bookkeeping.
- The live serializer still copies `2147483903` bytes from the payload.
- The overwrite lands in the stack frame of `SerializeUnknownFieldsToArray()`.
- The corrupted object is the local `stream` instance created at `wire_format.h:161`.

## Summary Table

| Check | Expected | Actual | Result |
|---|---:|---:|---|
| Payload length | `<= INT_MAX` | `2147483903` | BUG |
| `ComputeUnknownFieldsSize()` | exact unsigned size | `2147483909` | OK |
| `static_cast<int>(computed_size)` | positive `int` | `-2147483387` | BUG |
| Raw write signed size | positive `int` | `-2147483393` | BUG |
| Pre-copy signed remaining space | non-negative | `-2147483393` | BUG |
| Stack object at `wire_format.h:161` | no overwrite | overflow at offset `96` | BUG |

## Conclusion

This finding is validated as `STATE_BUG`.

- The key state bug is the signed truncation in `SerializeUnknownFieldsToArray()`.
- LLDB could not launch because `debugserver` is missing.
- GDB could not parse the available DWARF.
- The required fallback state capture still proves the bug exactly: the computed size wraps to a negative `int`, that incorrect state reaches `EpsCopyOutputStream`, and serialization overruns the stack-local `stream` object.
