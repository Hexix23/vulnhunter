# LLDB Debug Report: string_output_backup_overreach

## Build Information

- Build directory: `builds/protobuf-asan-arm64`
- Debug binary: `bugs/protobuf/string_output_backup_overreach/debugging/poc_debug`
- Fallback state binary: `bugs/protobuf/string_output_backup_overreach/debugging/poc_state_capture`
- Target source: `targets/protobuf/src/google/protobuf/io/zero_copy_stream_impl_lite.cc:158`

## Executive Summary

`google::protobuf::io::StringOutputStream::BackUp(int count)` only checks that
`count <= target_->size()`. It does not track the size returned by the most
recent `Next()` call. In the reproduced run, the last `Next()` returned
`second_size=32`, but `BackUp(40)` was accepted and reduced the live string size
from `71` to `31`. That retracts 8 bytes from the earlier committed `A` region,
not just from the most recent `B` region.

Status: `STATE_BUG`

## Debugger Attempt Log

### Attempt 1: LLDB batch mode

Command:

```bash
lldb -b -s bugs/protobuf/string_output_backup_overreach/debugging/lldb_commands.txt \
  bugs/protobuf/string_output_backup_overreach/debugging/poc_debug
```

Result:

```text
error: could not find 'debugserver'. Please ensure it is properly installed and available in your PATH
```

### Attempt 2: LLDB after codesign

Command:

```bash
codesign -s - -f bugs/protobuf/string_output_backup_overreach/debugging/poc_debug
lldb -b -s bugs/protobuf/string_output_backup_overreach/debugging/lldb_commands.txt \
  bugs/protobuf/string_output_backup_overreach/debugging/poc_debug
```

Result: same `debugserver` failure.

### Attempt 3: LLDB with explicit architecture

Command:

```bash
lldb --arch arm64 -b -s bugs/protobuf/string_output_backup_overreach/debugging/lldb_commands.txt \
  bugs/protobuf/string_output_backup_overreach/debugging/poc_debug
```

Result: same `debugserver` failure.

### Attempt 4: GDB fallback

`gdb` was not installed on this host.

### Attempt 5: Printf-based state capture

Used `bugs/protobuf/string_output_backup_overreach/debugging/poc_state_capture.cpp`
to capture the same runtime state directly from the ASan-linked protobuf build.

## Vulnerable Implementation

`StringOutputStream::BackUp()`:

```cpp
void StringOutputStream::BackUp(int count) {
  ABSL_CHECK_GE(count, 0);
  ABSL_CHECK(target_ != nullptr);
  ABSL_CHECK_LE(static_cast<size_t>(count), target_->size());
  target_->resize(target_->size() - count);
}
```

The missing invariant is: `count` should also be bounded by the size returned by
the most recent `Next()`.

## Runtime State Evidence

### 1. State before the overreaching `BackUp(40)`

Captured output:

```text
first_size=71
second_size=32
first_live_bytes=39
size_before_overreach=71
byte_count_before_overreach=71
capacity_before_overreach=71
overreach_request=40
live_prefix_before="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
```

Interpretation:

- `second_size=32`: the last `Next()` only granted 32 bytes.
- `overreach_request=40`: the subsequent `BackUp()` exceeds that grant by 8.
- `first_live_bytes=39`: bytes `0..38` belong to the earlier committed `A`
  region and must not be retracted by the final `BackUp()`.

### 2. Boundary bytes immediately before the bug triggers

```text
boundary_bytes_before [31..47] =
(31:A/0x41) (32:A/0x41) (33:A/0x41) (34:A/0x41) (35:A/0x41) (36:A/0x41)
(37:A/0x41) (38:A/0x41) (39:B/0x42) (40:B/0x42) (41:B/0x42) (42:B/0x42)
(43:B/0x42) (44:B/0x42) (45:B/0x42) (46:B/0x42) (47:B/0x42)
```

Interpretation:

- The live-region boundary is at index `39`.
- Bytes `31..38` are committed `A` bytes from the earlier segment.
- Bytes `39..70` are the latest `B` span.

### 3. State after `BackUp(40)`

```text
size_after_overreach=31
byte_count_after_overreach=31
capacity_after_overreach=71
live_prefix_after="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
```

Interpretation:

- The live size fell from `71` to `31`.
- A correct `BackUp(32)` would have produced `39`, not `31`.
- The extra 8-byte shrink proves the earlier committed region was retracted.

### 4. Boundary bytes after the bug triggers

```text
boundary_bytes_after [23..39] =
(23:A/0x41) (24:A/0x41) (25:A/0x41) (26:A/0x41) (27:A/0x41) (28:A/0x41)
(29:A/0x41) (30:A/0x41) (31:\0/0x00) (32:A/0x41) (33:A/0x41) (34:A/0x41)
(35:A/0x41) (36:A/0x41) (37:A/0x41) (38:A/0x41) (39:B/0x42)
```

Interpretation:

- Index `31` is now the string terminator because the live size became `31`.
- Bytes `32..38` still exist in the buffer but are no longer part of the live
  string.
- Those bytes are the 8 committed `A` bytes that were improperly discarded.

### 5. Raw buffer confirmation

Before:

```text
raw_bytes_before [0..70] =
41 41 41 41 41 41 41 41 41 41 41 41 41 41 41 41 41 41 41 41 41 41 41 41
41 41 41 41 41 41 41 41 41 41 41 41 41 41 41 42 42 42 42 42 42 42 42 42
42 42 42 42 42 42 42 42 42 42 42 42 42 42 42 42 42 42 42 42 42 42 42
```

After:

```text
raw_bytes_after [0..70] =
41 41 41 41 41 41 41 41 41 41 41 41 41 41 41 41 41 41 41 41 41 41 41 41
41 41 41 41 41 41 41 00 41 41 41 41 41 41 41 42 42 42 42 42 42 42 42 42
42 42 42 42 42 42 42 42 42 42 42 42 42 42 42 42 42 42 42 42 42 42 42
```

Interpretation:

- The resize inserted a null terminator at index `31`.
- The old `A` bytes at `32..38` and `B` bytes at `39..70` still remain in
  capacity-backed storage, confirming this is a logic-state bug rather than a
  memory safety crash.

## Summary Table

| Check | Expected | Actual | Result |
|---|---:|---:|---|
| Last `Next()` size | 32 | 32 | OK |
| `BackUp()` request | `<= 32` | 40 | BUG |
| Live size after final `BackUp()` | 39 | 31 | BUG |
| Previously committed `A` bytes preserved | yes | 8 bytes removed | BUG |
| ASan crash | not required | none | logic bug only |

## Conclusion

The runtime evidence proves a state bug in the real protobuf build:
`StringOutputStream::BackUp(40)` retracted 8 bytes beyond the last 32-byte span
returned by `Next()`. The implementation accepts the call because it compares
`count` against total string size instead of the most recent grant size.
