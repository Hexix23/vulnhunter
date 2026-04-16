# LLDB Debug Report: cord_output_backup_overreach

## Build Information

- Build directory: `builds/protobuf-asan-arm64/`
- Debug target: `bugs/protobuf/cord_output_backup_overreach/debugging/poc_debug`
- Instrumented source: `bugs/protobuf/cord_output_backup_overreach/debugging/poc_debug.cpp`
- Compile flags source: `builds/protobuf-asan-arm64/compile_flags.txt`
- Link flags source: `builds/protobuf-asan-arm64/link_flags.txt` plus fallback Abseil Cord libs from `poc/build_real.sh`
- Library code under test: `targets/protobuf/src/google/protobuf/io/zero_copy_stream_impl_lite.cc:659-691`

## Executive Summary

`CordOutputStream::BackUp(int count)` is documented to back up only within the most recent
`Next()` result, but the implementation enforces only `count <= ByteCount()` in practice.
For this PoC, the second `Next()` returns `7` bytes, then `BackUp(11)` is issued. The
captured state shows that `11` is accepted because total `ByteCount()` is `15`, and the
rollback removes not only the last `7` bytes but also `4` earlier bytes from the first
chunk. That incorrect state is observable before any crash. A later `Consume()` then
triggers ASan `use-after-poison`.

## Debugger Retry Status

### Attempt 1: LLDB batch mode

Saved output: `debugging/lldb_output.txt`

Result:

```text
error: could not find 'debugserver'. Please ensure it is properly installed and available in your PATH
```

### Attempt 2: LLDB batch mode with explicit `--arch arm64`

Saved output: `debugging/lldb_output_arch.txt`

Result:

```text
error: could not find 'debugserver'. Please ensure it is properly installed and available in your PATH
```

### Attempt 3: GDB fallback

Saved output: `debugging/gdb_output.txt`

Result:

```text
DW_FORM_GNU_str_index or DW_FORM_strx used without .debug_str section
```

Because both native debugger paths failed on this machine, the final evidence comes from
the required fallback: an instrumented debug binary compiled against the prebuilt ASan
protobuf libraries.

## Breakpoint Plan

The reproducible LLDB command file is saved as:

- `bugs/protobuf/cord_output_backup_overreach/debugging/lldb_commands.txt`

It sets breakpoints at:

- `poc_debug.cpp:106` before `output.BackUp(overreach);`
- `zero_copy_stream_impl_lite.cc:665` inside `CordOutputStream::BackUp`
- `zero_copy_stream_impl_lite.cc:688` inside `CordOutputStream::Consume`

## Relevant Source

```cpp
void CordOutputStream::BackUp(int count) {
  assert(0 <= count && count <= ByteCount());
  if (count == 0) return;

  const int buffer_length = static_cast<int>(buffer_.length());
  assert(count <= buffer_length);
  if (count <= buffer_length) {
    buffer_.SetLength(static_cast<size_t>(buffer_length - count));
    state_ = State::kPartial;
  } else {
    buffer_ = {};
    cord_.RemoveSuffix(static_cast<size_t>(count));
    state_ = State::kSteal;
  }
}

absl::Cord CordOutputStream::Consume() {
  cord_.Append(std::move(buffer_));
  state_ = State::kEmpty;
  return std::move(cord_);
}
```

The logic gap is that the public restriction is "do not back up beyond the last `Next()`",
but the runtime state used here allows `count=11` while the last `Next()` granted only `7`.

## Step-by-Step Evidence

### 1. State after two `Next()` calls

From `debugging/state_capture.txt`:

```text
[STATE] after first Next()
  ByteCount()=8
  cord_.size()=0
  buffer_.length()=8
  buffer_.capacity()=15
  buffer_.slack()=7
  state_=2 (kPartial)
[BYTES] first chunk @ 0x16d0add99 = 41 41 41 41 41 41 41 41

[STATE] after second Next()
  ByteCount()=15
  cord_.size()=0
  buffer_.length()=15
  buffer_.capacity()=15
  buffer_.slack()=0
  state_=1 (kFull)
[BYTES] second chunk @ 0x16d0adda1 = 42 42 42 42 42 42 42
```

Interpretation:

- First `Next()` yielded `8` bytes.
- Second `Next()` yielded `7` bytes.
- The full visible buffer is `8` `'A'` bytes followed by `7` `'B'` bytes.

### 2. Invalid-for-contract backup request is still accepted by object state

From `debugging/state_capture.txt`:

```text
[CHECK] second_size=7
[CHECK] second_offset_in_buffer=8
[CHECK] last_next_end_offset=15
[CHECK] overreach=11
[CHECK] overreach > second_size = 1
[CHECK] overreach > buffer_.length() = 0
[CHECK] overreach <= ByteCount() = 1
[CHECK] bytes removed before second chunk = 4
```

Interpretation:

- `overreach=11` is `4` bytes larger than the most recent `Next()` result.
- The request is still accepted because `11 <= ByteCount()` and `11 <= buffer_.length()`.
- Those extra `4` bytes can only come from older data, proving a rollback beyond the last
  `Next()` window.

### 3. Memory bytes prove earlier data is removed

Before backup:

```text
[BYTES] buffer before BackUp @ 0x16d0add99 = 41 41 41 41 41 41 41 41 42 42 42 42 42 42 42
```

After backup:

```text
[STATE] after BackUp(overreach)
  ByteCount()=4
  cord_.size()=0
  buffer_.length()=4
  buffer_.capacity()=15
  buffer_.slack()=11
  state_=2 (kPartial)
[BYTES] buffer after BackUp @ 0x16d0add99 = 41 41 41 41
```

Interpretation:

- `ByteCount()` drops from `15` to `4`.
- `buffer_.length()` drops from `15` to `4`.
- The resulting bytes are only the first four `'A'` bytes.
- So the call removed all `7` `'B'` bytes and also `4` bytes from the earlier `'A'` region.

This is the state bug: the operation backed up beyond the most recent `Next()`.

### 4. Downstream consequence in `Consume()`

From `debugging/consume_capture.txt`:

```text
==77613==ERROR: AddressSanitizer: use-after-poison on address 0x00016fce5d59
WRITE of size 4 at 0x00016fce5d59 thread T0
    #0 0x000100ae6d00 in memcpy+0x260
    #1 0x000100126f98 in google::protobuf::io::CordOutputStream::Consume()+0xf4
    #2 0x000100119350 in main+0x560
```

ASan also identifies the poisoned access as occurring inside stack object `output`:

```text
[112, 168) 'output' (line 63) <== Memory access at offset 121 is inside this variable
```

Interpretation:

- The incorrect rollback state is not merely theoretical.
- A subsequent `Consume()` uses poisoned stack-backed memory and crashes under ASan.

## Summary Table

| Check | Expected | Actual | Result |
|---|---|---|---|
| Second `Next()` size | 7 | 7 | OK |
| Allowed `BackUp()` count | `<= 7` | `11` | BUG |
| `BackUp()` allowed by `ByteCount()` | should not matter | `11 <= 15` | Incorrect gate |
| Bytes removed before second chunk | 0 | 4 | BUG |
| `ByteCount()` after backup | should retain first chunk intact | 4 | BUG |
| `Consume()` after bad state | safe | ASan `use-after-poison` | BUG |

## Conclusion

Status: `STATE_BUG`

The runtime evidence proves the bug even before `Consume()` crashes:

- `BackUp(11)` exceeds the most recent `Next()` size of `7`.
- The object still accepts that rollback because it relies on total size state.
- Earlier bytes are removed, leaving only `4` bytes from the original `15`.
- That corrupted state later triggers ASan `use-after-poison` in `Consume()`.

This is sufficient forensic evidence that `cord_output_backup_overreach` is a real state bug
with a downstream memory-safety consequence in the prebuilt ASan protobuf library.
