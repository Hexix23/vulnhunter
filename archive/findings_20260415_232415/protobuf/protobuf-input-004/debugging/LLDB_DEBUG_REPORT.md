# LLDB Debug Report: protobuf-input-004

## Build Information

- Build directory: `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/builds/protobuf-asan-arm64`
- Source used: `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/protobuf-input-004/validation/poc_real.cpp`
- Debug binary: `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/protobuf-input-004/debugging/poc_debug`
- Rosetta status: `0` (native arm64 shell)

## Executive Summary

`_upb_DescState_Grow()` computes `const int used = d->ptr - d->buf` even though the buffer accounting is naturally `ptrdiff_t`/`size_t`. With a logical pointer delta of `2147483679`, the narrowed `int` becomes `-2147483617`. That turns the free-space check into a large positive value and causes the function to skip a realloc that is still required.

LLDB batch launch was attempted three ways and failed before process start with `error: process exited with status -1 (no such process)`. Because the debugger could not attach in this sandbox, the final evidence uses the existing instrumented PoC as the required fallback method.

## Debugger Attempts

### Attempt 1: Native LLDB

Command:

```bash
xcrun lldb -b -s /tmp/protobuf-input-004-lldb.txt /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/protobuf-input-004/debugging/poc_debug
```

Result:

```text
(lldb) run
error: process exited with status -1 (no such process)
```

### Attempt 2: Codesigned binary

Command:

```bash
codesign -s - -f /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/protobuf-input-004/debugging/poc_debug
xcrun lldb -b -s /tmp/protobuf-input-004-lldb.txt /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/protobuf-input-004/debugging/poc_debug
```

Result:

```text
(lldb) run
error: process exited with status -1 (no such process)
```

### Attempt 3: `arch -arm64` retry

Command:

```bash
arch -arm64 /bin/bash -lc 'xcrun lldb -b -s /tmp/protobuf-input-004-lldb.txt /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/protobuf-input-004/debugging/poc_debug'
```

Result:

```text
(lldb) run
error: process exited with status -1 (no such process)
```

## Fallback State Evidence

### 1. Truncation is observable before any write

Output from `state_capture_logic.txt`:

```text
logical_used_64=2147483679
truncated_used_32=-2147483617
old_bufsize=64
remaining_with_64bit_math=18446744071562068001
remaining_with_truncated_math=2147483681
min_required=16
grow_returned=true
buf_changed=false
ptr_changed=false
bufsize_after=64
ptr_distance_after=2147483679
expected_realloc=true
skipped_realloc=true
```

Interpretation:

- `logical_used_64=2147483679` shows the true pointer delta is larger than `INT_MAX`.
- `truncated_used_32=-2147483617` shows the narrowing bug at the exact operation under review.
- `expected_realloc=true` but `skipped_realloc=true` is the key state mismatch: the function returned success without growing the 64-byte buffer.
- `buf_changed=false`, `ptr_changed=false`, and `bufsize_after=64` prove the object state remained stale after `_upb_DescState_Grow()`.

### 2. The stale state immediately leads to an out-of-bounds library write

Output from `state_capture_write.txt`:

```text
attempting_follow_on_library_write=true
AddressSanitizer:DEADLYSIGNAL
==32741==ERROR: AddressSanitizer: BUS on unknown address
==32741==The signal is caused by a WRITE memory access.
    #0 0x000100087f48 in upb_MtDataEncoder_PutRaw+0x64
    #1 0x0001000891ec in upb_MtDataEncoder_StartMessage+0xcc
    #2 0x000100082cd8 in main+0x528
SUMMARY: AddressSanitizer: BUS ... in upb_MtDataEncoder_PutRaw+0x64
```

This confirms the incorrect state is not benign. Once encoder code trusts the stale descriptor scratch state, the next library write faults in `upb_MtDataEncoder_PutRaw`.

## Conclusion

Status: `STATE_BUG`

The runtime state is incorrect even before the crash:

- True used bytes exceed `INT_MAX`.
- The value stored in `used` is negative due to truncation.
- `_upb_DescState_Grow()` returns success and skips a required growth.
- A follow-on encoder write then crashes under ASan.

This is valid runtime evidence for the signed/unsigned truncation bug in `_upb_DescState_Grow()`, obtained through the required fallback path because LLDB launch was blocked in this environment.
