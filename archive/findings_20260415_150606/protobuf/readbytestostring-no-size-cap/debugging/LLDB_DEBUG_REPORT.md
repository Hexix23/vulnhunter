# LLDB Debug Report: readbytestostring-no-size-cap

## Build Information

- Build directory: `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/builds/protobuf-asan-arm64`
- Debug binary: `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/readbytestostring-no-size-cap/debugging/poc_debug`
- Fallback capture binary: `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/readbytestostring-no-size-cap/debugging/poc_state_capture`
- Target library: `builds/protobuf-asan-arm64/lib/libprotobuf.a`

## Executive Summary

`WireFormatLite::ReadBytes()` decodes a `uint32_t` length in `wire_format_lite.cc:548` and forwards it to `CodedInputStream::ReadString(std::string*, int)` without a local range check.

For oversized length-delimited fields, the runtime state proves a signed narrowing bug:

- `0x80000000` becomes `-2147483648`
- `0xffffffff` becomes `-1`

Those values are incorrect for a byte count and show the missing local size cap is real. The downstream `ReadString()` guard in `coded_stream.cc:262` rejects the negative `int`, so there is no ASan crash or stream-limit corruption in this test.

## Debugger Attempts

LLDB batch execution was attempted three ways:

1. `lldb -b -s lldb_commands.txt ./poc_debug`
2. `lldb --arch arm64 -b -s lldb_commands.txt ./poc_debug`
3. Xcode LLDB with `debugserver` added to `PATH`

All attempts failed to launch under this environment. The saved outputs are:

- `lldb_output.txt`
- `lldb_output_arch.txt`
- `lldb_output_pathfix.txt`

Because `gdb` is not installed, evidence was collected with the required fallback state-capture binary.

## Step-by-Step Evidence

### 1. Vulnerable boundary: unsigned length is decoded successfully

From `state_capture_output.txt` for `wraps_negative_int`:

```text
case=wraps_negative_int
declared_length_u32=2147483648
declared_length_i32=-2147483648
wire_prefix=0a 80 80 80 80 08 58
read_varint_ok=true
decoded_length_u32=2147483648
decoded_length_i32=-2147483648
bytes_until_limit_before_readstring=1
current_position_before_readstring=6
out_size_before_readstring=8
```

Interpretation:

- The wire length varint is accepted as `2147483648`.
- The same value narrows to `-2147483648` when treated as `int`.
- The parser has only one byte of payload left, but the decoded logical length is already outside the signed range expected by `ReadString(int)`.

### 2. The downstream guard rejects the negative size cleanly

Still from `wraps_negative_int`:

```text
read_string_ok=false
out_size_after_readstring=8
bytes_until_limit_after_readstring=1
current_position_after_readstring=6
consumed_all=false
```

Interpretation:

- `ReadString()` returns `false` immediately.
- `out` is unchanged at size `8` (`"sentinel"`).
- `CurrentPosition()` remains `6`.
- `BytesUntilLimit()` remains `1`.

This shows the negative signed size is rejected before any read or resize occurs.

### 3. The same signed-state bug occurs for `0xffffffff`

From `all_bits_set`:

```text
declared_length_u32=4294967295
decoded_length_u32=4294967295
decoded_length_i32=-1
read_string_ok=false
bytes_until_limit_after_readstring=1
current_position_after_readstring=6
```

Interpretation:

- A second oversized varint produces another impossible signed byte count.
- The parser again rejects it without consuming the payload byte.

### 4. Large positive values do not wrap, but still fail safely when truncated

From `int_max_truncated`:

```text
decoded_length_u32=2147483647
decoded_length_i32=2147483647
read_string_ok=false
out_size_after_readstring=1
bytes_until_limit_after_readstring=0
current_position_after_readstring=7
```

Interpretation:

- `INT_MAX` stays positive.
- `ReadStringFallback()` consumes the one available payload byte, then fails on truncation.
- This is normal safe-failure behavior, not a signed wrap.

## Source Correlation

- `targets/protobuf/src/google/protobuf/wire_format_lite.cc:547-548`
  - Reads `uint32_t length`
  - Immediately calls `input->ReadString(value, length)`
- `targets/protobuf/src/google/protobuf/io/coded_stream.cc:261-262`
  - `ReadString(std::string* buffer, int size)`
  - `if (size < 0) return false;`

## Summary Table

| Check | Expected | Actual | Result |
|---|---|---|---|
| Decoded byte length for `0x80000000` | positive bounded size | `decoded_length_i32=-2147483648` | BUG |
| Decoded byte length for `0xffffffff` | positive bounded size | `decoded_length_i32=-1` | BUG |
| Stream state after wrapped-negative call | possible corruption if bug propagates | position unchanged, limit unchanged | Safe reject |
| ASan / memory safety outcome | crash or overwrite if exploitable | none observed | No memory corruption |

## Conclusion

Status: `STATE_BUG`

The missing local size cap in `ReadBytesToString()` is observable at runtime as a signed narrowing bug. Oversized wire lengths become negative `int` values at the `ReadString()` boundary, which is incorrect state for a byte count. The downstream guard prevents memory corruption in this tested path, so the finding is best classified as a logic/state bug rather than a confirmed memory-safety issue.
