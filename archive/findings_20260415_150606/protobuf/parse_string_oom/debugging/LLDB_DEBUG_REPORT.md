# LLDB Debug Report: parse_string_oom

## Build Information

- Build directory: `builds/protobuf-asan-arm64/`
- Library source under test: `google/protobuf/io/coded_stream.cc`
- Debug harness: `bugs/protobuf/parse_string_oom/debugging/poc_debug.cpp`
- Debug binary: `bugs/protobuf/parse_string_oom/debugging/poc_debug`

## Executive Summary

The original `Any`-based PoC was not usable for debugger evidence because it crashed during protobuf descriptor initialization before payload parsing began. A minimal `CodedInputStream` harness was created to exercise the claimed oversized-string path directly using the prebuilt protobuf ASan libraries.

Observed runtime state is defensive, not corrupt:

- The varint length is parsed as `1073741824` (`0x40000000`, 1 GiB).
- `ReadString()` returns `false` instead of allocating or overrunning memory.
- The output string only contains the 3 supplied bytes (`41 42 43`, `"ABC"`).
- After an overflow-style `PushLimit(INT_MAX)` from position 5, `BytesUntilLimit()` is `-1`, which matches upstream protobuf tests for overflow/negative-limit handling rather than a limit-bypass regression.

Result: `STATE_OK`

## Debugger Execution Status

LLDB batch commands were prepared and saved in `lldb_commands.txt`, but runtime launching failed twice:

1. `lldb -b -s lldb_commands.txt ./poc_debug`
2. `lldb --arch arm64 -b -s lldb_commands.txt ./poc_debug`

Both attempts stopped with:

```text
error: could not find 'debugserver'. Please ensure it is properly installed and available in your PATH
```

`gdb` was not available in the environment, so evidence was captured with the instrumented fallback harness as required by the retry policy.

## Reproduction Commands

```bash
ROOT=/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter
BUILD_DIR="$ROOT/builds/protobuf-asan-arm64"
DEBUG_DIR="$ROOT/bugs/protobuf/parse_string_oom/debugging"
COMPILE_FLAGS="$(cat "$BUILD_DIR/compile_flags.txt")"
LINK_FLAGS="$(cat "$BUILD_DIR/link_flags.txt")"

xcrun clang++ -arch arm64 -stdlib=libc++ $COMPILE_FLAGS -g \
  "$DEBUG_DIR/poc_debug.cpp" $LINK_FLAGS \
  -L/opt/homebrew/lib -I/opt/homebrew/include \
  -labsl_cord -labsl_cord_internal -labsl_cordz_functions -labsl_cordz_handle \
  -labsl_cordz_info -labsl_hash -labsl_hashtablez_sampler -labsl_raw_hash_set \
  -labsl_status -labsl_statusor -labsl_synchronization -labsl_time \
  -labsl_time_zone -labsl_log_entry -labsl_log_globals -labsl_log_initialize \
  -labsl_log_internal_conditions -labsl_log_internal_format \
  -labsl_log_internal_globals -labsl_log_internal_nullguard -labsl_log_sink \
  -labsl_log_severity -labsl_vlog_config_internal -labsl_kernel_timeout_internal \
  -labsl_crc_cord_state -labsl_crc32c -labsl_crc_internal -labsl_crc_cpu_detect \
  -labsl_city -labsl_int128 -lc++ -o "$DEBUG_DIR/poc_debug"

codesign -s - -f "$DEBUG_DIR/poc_debug" || true
lldb -b -s "$DEBUG_DIR/lldb_commands.txt" "$DEBUG_DIR/poc_debug"

# Fallback state capture used for final evidence:
"$DEBUG_DIR/poc_debug" 2>&1 | tee "$DEBUG_DIR/state_output.txt"
```

## Step-by-Step Evidence

### 1. Oversized length is decoded correctly

From `state_output.txt`:

```text
parsed_length=1073741824
current_position_before_read=5
bytes_until_limit_before_read=-1
bytes_until_total_limit_before_read=-1
```

Interpretation:

- The 5-byte varint was decoded as exactly `0x40000000` (1 GiB).
- The stream cursor advanced to byte 5, immediately after the varint.
- No local or total limit was active before the read (`-1` means no active limit).

### 2. `ReadString()` fails safely instead of allocating or overrunning

From `state_output.txt`:

```text
read_ok=false
current_position_after_read=8
bytes_until_limit_after_read=-1
bytes_until_total_limit_after_read=-1
output_size=3
output_capacity=22
output_hex=414243
```

Interpretation:

- `ReadString()` returned `false`, so protobuf rejected the impossible read.
- The cursor advanced from 5 to 8, consuming only the 3 bytes actually present.
- The resulting string contains only `41 42 43` (`"ABC"`).
- No oversized allocation or incorrect negative-size state was observed.

### 3. Overflow guard in `PushLimit()` behaves as designed

From `state_output.txt`:

```text
overflow_limit_old=2147483647
overflow_current_position=5
overflow_limit_after_push=-1
```

Interpretation:

- The old limit was `INT_MAX`.
- Calling `PushLimit(INT_MAX)` from current position 5 would overflow the absolute end position.
- Protobuf kept the effective limit unchanged, so `BytesUntilLimit()` remained `-1`.
- This matches the upstream tests in `coded_stream_unittest.cc` for overflow and negative limits; it is not evidence of a new logic bug in this finding.

## Conclusion

The claimed `parse_string_oom` condition was not reproduced as an incorrect runtime state.

- Large string length observed: yes
- Incorrect state observed: no
- Unexpected negative size/limit: no
- Unsafe allocation or overflow: no

The protobuf runtime behaved defensively and returned failure without corrupting state. The appropriate validation result for this LLDB/state-capture pass is `STATE_OK`.
