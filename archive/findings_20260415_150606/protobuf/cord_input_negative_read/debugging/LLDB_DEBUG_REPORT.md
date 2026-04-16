# LLDB Debug Report: cord_input_negative_read

## Build Information

- Build directory: `builds/protobuf-asan-arm64`
- Debug binary: `bugs/protobuf/cord_input_negative_read/debugging/poc_debug`
- Fallback state binary: `bugs/protobuf/cord_input_negative_read/debugging/poc_state_capture`
- Source under test:
  - `google/protobuf/io/coded_stream.cc:313`
  - `google/protobuf/io/coded_stream.h:1384`
  - `google/protobuf/wire_format_lite.h:1197`

## Executive Summary

The intended LLDB session could not attach on this host because `debugserver` is unavailable. Per the retry policy, the binary was codesigned, LLDB was retried with explicit `arm64`, `gdb` availability was checked, and the final evidence was captured with a fallback debug binary that prints the same runtime state through public protobuf APIs.

The captured state supports `STATE_OK`, not `STATE_BUG`:

- `CodedInputStream::ReadCord(&output, -1)` returns `false`, clears the destination cord, and does not advance the stream.
- `CodedInputStream::ReadVarintSizeAsInt(&length)` returns `false` for the oversized varint, leaves `CurrentPosition()==0`, and reports `length == -1` only as a failure sentinel.
- `WireFormatLite::ReadBytes()` returns `false`, leaves the destination cord unchanged, and does not advance the stream.

## Reproduction Commands

Saved in `bugs/protobuf/cord_input_negative_read/debugging/lldb_commands.txt`.

LLDB attempts and fallback transcripts:

- `bugs/protobuf/cord_input_negative_read/debugging/lldb_attempts_output.txt`
- `bugs/protobuf/cord_input_negative_read/debugging/state_capture_output.txt`

## LLDB Attempt Status

### Attempt 1: Batch LLDB

```text
error: could not find 'debugserver'. Please ensure it is properly installed and available in your PATH
```

### Attempt 2: Explicit Architecture

```text
error: could not find 'debugserver'. Please ensure it is properly installed and available in your PATH
```

### Attempt 3: GDB Fallback

`gdb` is not installed on this host.

## Fallback Runtime Evidence

### 1. Direct negative Cord read

State capture output:

```text
[direct] before.output_size=8
[direct] before.output_hex=73656e74696e656c
[direct] before.current_position=0
[direct] before.bytes_until_limit=-1
[direct] call.size=-1
[direct] after.ok=0
[direct] after.output_size=0
[direct] after.output_hex=
[direct] after.current_position=0
[direct] after.bytes_until_limit=-1
```

Interpretation:

- The call is made with `size=-1`.
- The function returns `ok=0`.
- The output cord changes from `"sentinel"` to empty, matching the `output->Clear(); return false;` guard in `coded_stream.cc`.
- `CurrentPosition()` stays `0`, so no bytes are consumed.
- `BytesUntilLimit()` is `-1` both before and after the call. That is the normal protobuf sentinel for "no limit set", not a newly introduced bypass.

### 2. Oversized varint length

State capture output:

```text
[varint] encoded_bytes=ff ff ff ff 0f 44 41 54 41
[varint] before.current_position=0
[varint] after.ok=0
[varint] after.length=-1
[varint] after.current_position=0
[varint] after.bytes_until_limit=-1
```

Interpretation:

- The malformed length prefix decodes to a value that does not fit in a non-negative `int`.
- `ReadVarintSizeAsInt()` returns `ok=0`.
- The observed `length=-1` is returned together with failure and is not consumed by downstream parsing.
- `CurrentPosition()` remains `0`, so the malformed varint does not advance the stream.

### 3. WireFormatLite::ReadBytes path

State capture output:

```text
[wireformat] before.output_size=9
[wireformat] before.output_hex=70726566696c6c6564
[wireformat] before.current_position=0
[wireformat] after.ok=0
[wireformat] after.output_size=9
[wireformat] after.output_hex=70726566696c6c6564
[wireformat] after.current_position=0
[wireformat] after.bytes_until_limit=-1
```

Interpretation:

- `WireFormatLite::ReadBytes()` returns `false`.
- The destination cord remains `"prefilled"`.
- `CurrentPosition()` remains `0`.
- This shows the malformed size is rejected before any Cord read occurs.

## Source Correlation

Relevant implementation behavior matches the runtime evidence:

- `coded_stream.cc:317-319`: negative `size` clears the cord and returns `false`.
- `coded_stream.h:1393-1394`: `ReadVarintSizeAsInt()` stores the fallback result and returns `*value >= 0`.
- `wire_format_lite.h:1199-1200`: `ReadBytes()` only calls `ReadCord()` if `ReadVarintSizeAsInt(&length)` succeeds.

## Conclusion

Status: `STATE_OK`

No incorrect parser state was observed. The negative direct read is rejected safely, the oversized varint does not advance parsing, and the length-prefixed `ReadBytes()` path never passes a dangerous negative size into `ReadCord()`.
