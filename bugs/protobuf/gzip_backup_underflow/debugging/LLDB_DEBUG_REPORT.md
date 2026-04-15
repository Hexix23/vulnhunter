# LLDB Debug Report: gzip_backup_underflow

## Status

**STATE_BUG**

LLDB breakpoint resolution succeeded, but live execution under LLDB was blocked on this host because `/opt/homebrew/opt/llvm/bin/lldb` could not launch without `debugserver`. Per the required fallback chain, the final state evidence below was captured with the dedicated debug PoC binary and saved in `debugging/state_capture_output.txt`.

## Build Information

- Build directory: `builds/protobuf-asan-arm64`
- Target binary: `bugs/protobuf/gzip_backup_underflow/debugging/poc_debug`
- Source PoC: `bugs/protobuf/gzip_backup_underflow/debugging/poc_state_capture.cpp`
- Vulnerable function: `google::protobuf::io::GzipInputStream::BackUp(int)` at `targets/protobuf/src/google/protobuf/io/gzip_stream.cc:164`
- Derived state sink: `google::protobuf::io::GzipInputStream::ByteCount() const` at `targets/protobuf/src/google/protobuf/io/gzip_stream.cc:181`

## Reproducible Build

The plain `link_flags.txt` was not sufficient on this host. A working debug build required the same retry strategy already used elsewhere in this repo, ending with:

```bash
xcrun clang++ -arch arm64 $(cat builds/protobuf-asan-arm64/compile_flags.txt) -g \
  bugs/protobuf/gzip_backup_underflow/debugging/poc_state_capture.cpp \
  $(cat builds/protobuf-asan-arm64/link_flags.txt) -lz \
  -labsl_cord -labsl_cord_internal -labsl_cordz_info \
  -Wl,-rpath,/opt/homebrew/opt/abseil/lib \
  -o bugs/protobuf/gzip_backup_underflow/debugging/poc_debug
```

## Debugger Attempts

### Attempt 1: LLDB

- Command file: `debugging/lldb_commands.txt`
- Result: breakpoint setup succeeded, `run` failed with `could not find 'debugserver'`

### Attempt 2: codesign + LLDB

- `codesign -s - -f debugging/poc_debug`
- Result: same `debugserver` failure

### Attempt 3: `lldb --arch arm64`

- Result: same `debugserver` failure

### Attempt 4: state-capture fallback

- Executed `debugging/poc_debug` directly
- Captured internal fields by compiling a dedicated PoC that exposes `GzipInputStream` private state
- Output saved to `debugging/state_capture_output.txt`

## Executive Summary

`GzipInputStream::BackUp(int count)` subtracts `count` from `output_position_` with no bounds check:

```cpp
void GzipInputStream::BackUp(int count) {
  output_position_ = reinterpret_cast<void*>(
      reinterpret_cast<uintptr_t>(output_position_) - count);
}
```

If `count` is larger than the size returned by the previous `Next()`, `output_position_` moves before `output_buffer_`. `ByteCount()` then interprets the widened gap between `next_out` and `output_position_` as valid unread bytes:

```cpp
ret += reinterpret_cast<uintptr_t>(zcontext_->context.next_out) -
       reinterpret_cast<uintptr_t>(output_position_);
```

That produces incorrect stream state even though the library does not crash during this specific sequence.

## Step-by-Step Evidence

### 1. After the first `Next()`

Observed output:

```text
[after first Next()]
  output_buffer=0x6030000059b0
  output_position=0x6030000059c4
  next_out=0x6030000059c4
  output_buffer_length=32
  z_total_out=20
  output_position_minus_buffer=20
  next_out_minus_output_position=0
  ByteCount()=20
  first_ptr=0x6030000059b0
  first_size=20
```

Interpretation:

- The decompressor produced a valid 20-byte slice.
- `output_position_` is exactly 20 bytes into the 32-byte buffer.
- `ByteCount()` is correct at this point.

### 2. After oversized `BackUp(first_size + 32)`

Observed output:

```text
[after oversized BackUp()]
  output_buffer=0x6030000059b0
  output_position=0x603000005990
  next_out=0x6030000059c4
  output_buffer_length=32
  z_total_out=20
  output_position_minus_buffer=-32
  next_out_minus_output_position=52
  ByteCount()=72
  backup_count=52
```

Interpretation:

- `backup_count` is 52 even though the previous `Next()` exposed only 20 valid bytes.
- `output_position_` moved from `0x...59c4` back to `0x...5990`.
- That is **32 bytes before** `output_buffer_` at `0x...59b0`.
- `ByteCount()` jumped from 20 to 72 even though no additional data was decompressed.

This is the core state bug:

| Check | Expected | Actual | Result |
|---|---:|---:|---|
| Previous readable size | 20 | 20 | OK |
| Allowed backup range | `0..20` | `52` | **BUG** |
| `output_position_ - output_buffer_` | `>= 0` | `-32` | **BUG** |
| `ByteCount()` after backup | `<= 20` | `72` | **BUG** |

### 3. After the second `Next()`

Observed output:

```text
[after second Next()]
  output_buffer=0x6030000059b0
  output_position=0x6030000059c4
  next_out=0x6030000059c4
  ByteCount()=20
  second_ptr=0x603000005990
  second_size=52
  pointer_delta=32
  second_ptr_before_output_buffer=1
```

Interpretation:

- `second_ptr` is `0x...5990`, still 32 bytes before the valid output buffer start.
- `second_size` is 52, which exceeds the 20 bytes actually decompressed.
- `second_ptr_before_output_buffer=1` confirms the returned pointer is outside the valid buffer window.

## Why This Is A Real Bug

This is not a benign API misuse that gets rejected. The library accepts the oversized backup, stores an underflowed internal pointer, inflates `ByteCount()`, and then returns a caller-visible `(pointer, size)` pair describing bytes outside the valid decompression buffer.

The incorrect state is directly observable:

- negative buffer-relative offset: `output_position_minus_buffer=-32`
- inflated readable byte count: `ByteCount()=72`
- invalid pointer returned to caller: `second_ptr_before_output_buffer=1`
- invalid exposed length: `second_size=52`

## Conclusion

`gzip_backup_underflow` is validated as a **STATE_BUG**. The bug is an unchecked backup underflow in `GzipInputStream::BackUp(int)` that causes `ByteCount()` inflation and makes the next `Next()` return a pointer/size pair that extends 32 bytes before `output_buffer_`.

## Artifacts

- `debugging/lldb_commands.txt`
- `debugging/lldb_output.txt`
- `debugging/poc_debug`
- `debugging/poc_state_capture.cpp`
- `debugging/state_capture_output.txt`
