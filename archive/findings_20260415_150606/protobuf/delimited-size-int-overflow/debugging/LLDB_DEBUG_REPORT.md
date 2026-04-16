# LLDB Debug Report: delimited-size-int-overflow

## Build Information

- Build directory: `builds/protobuf-asan-arm64`
- Debug binary: `bugs/protobuf/delimited-size-int-overflow/debugging/poc_debug`
- PoC source: `bugs/protobuf/delimited-size-int-overflow/poc/poc_real.cpp`
- Target code:
  - `targets/protobuf/src/google/protobuf/io/coded_stream.h:423`
  - `targets/protobuf/src/google/protobuf/io/coded_stream.cc:125`

## Executive Summary

This finding reproduces as a logic bug in the real protobuf library. The
delimited length is read as `uint32_t 0x80000000`, then narrowed to
`int -2147483648` before calling `CodedInputStream::PushLimit()`. The
`PushLimit()` guard rejects the negative value, leaves `current_limit_`
unchanged, and the stream reports `BytesUntilLimit() == -1`, which means "no
active limit". The payload bytes are then consumed successfully.

LLDB could not be used interactively on this host because `debugserver` is not
available. The required retry chain was executed anyway:

1. `lldb -b -s ...`
2. ad-hoc `codesign` and retry
3. `lldb --arch arm64 -b -s ...`
4. checked for `gdb` (`not installed`)
5. used direct state capture from the debug PoC

The direct state capture is sufficient here because the bug is a non-crashing
state violation, and the PoC prints the exact values needed to prove it.

## Relevant Source

`CodedInputStream::ReadLengthAndPushLimit()` is the vulnerable shorthand:

```cpp
uint32_t length;
return PushLimit(ReadVarint32(&length) ? length : 0);
```

`CodedInputStream::PushLimit()` only updates the limit if all three conditions
hold:

```cpp
if (byte_limit >= 0 &&
    byte_limit <= INT_MAX - current_position &&
    byte_limit < current_limit_ - current_position) {
  current_limit_ = current_position + byte_limit;
  RecomputeBufferLimits();
}
```

When `length == 0x80000000`, narrowing to `int` produces `-2147483648`, so the
first condition fails and the limit is not installed.

## Step-by-Step Evidence

### 1. Crafted delimited length

The PoC feeds the library this byte sequence:

```text
input_hex=80 80 80 80 08 de ad be ef 41 42 43 44
```

The first five bytes are the varint encoding of `0x80000000`. The remaining
eight bytes are payload.

### 2. Length read as unsigned, then narrowed to signed

Direct state capture from `poc_debug`:

```text
size_u32=2147483648
size_hex=0x80000000
narrowed_size_i32=-2147483648
int_max=2147483647
```

Interpretation:

- Expected for a safe delimited parse: a non-negative `int` length
- Actual: the unsigned 32-bit length overflows the signed `int` domain
- Result: the value passed to `PushLimit()` is negative

### 3. Position and remaining payload at the limit call

```text
position_after_size=5
bytes_remaining=8
```

Interpretation:

- Five bytes were consumed by `ReadVarint32()`
- Eight payload bytes remain and should have been fenced by the new limit

### 4. Limit installation fails open

```text
bytes_until_limit_after_push=-1
```

Interpretation:

- `BytesUntilLimit() == -1` means there is no effective active limit
- This is the key incorrect state
- It matches the `PushLimit()` branch logic: the negative `byte_limit` causes
  the guarded assignment to `current_limit_` to be skipped

### 5. The remaining payload is still consumed

```text
skip_remaining_succeeded=true
final_position=13
```

Interpretation:

- The stream successfully consumed all eight remaining payload bytes
- Final position `13` equals the full input size, so the payload was not
  constrained by a length boundary

## Debugger Transcript

The prepared LLDB script is saved in `lldb_commands.txt`. LLDB successfully set
breakpoints in:

- `poc_real.cpp:48`
- `coded_stream.cc:125`
- `coded_stream.cc:132`
- `poc_real.cpp:51`
- `poc_real.cpp:54`

However, both launch attempts stopped at:

```text
error: could not find 'debugserver'. Please ensure it is properly installed and available in your PATH
```

Environment evidence:

```text
DevToolsSecurity[...]: [fatal] Failed to get right definition for: system.privilege.taskport.debug
gdb not installed
```

This is a host debugger entitlement issue, not a reproduction failure. The
logic bug is still demonstrated by the direct state capture.

## Summary Table

| Check | Expected | Actual | Result |
|-------|----------|--------|--------|
| Delimited size (`uint32_t`) | small positive value | `2147483648` (`0x80000000`) | suspicious |
| Narrowed `int` size | non-negative | `-2147483648` | BUG |
| `BytesUntilLimit()` after `PushLimit()` | bounded positive value | `-1` | BUG |
| Remaining payload consumption | blocked by limit | `skip_remaining_succeeded=true` | BUG |
| Final position | inside bounded submessage | `13` (entire input) | BUG |

## Conclusion

Status: `STATE_BUG`

This finding is validated as a real logic bug. The overflowed size disables
effective `PushLimit()` enforcement in the real library. No ASan crash is
required for validity because the incorrect parser state is directly observed:

- signed overflow on the length parameter
- no active limit after `PushLimit()`
- successful consumption of bytes that should have been bounded
