# LLDB Debug Report: ArrayInputStream Size Truncation

## Build Information

- Build directory: `builds/protobuf-asan-arm64`
- Debug binary: `bugs/protobuf/arrayinputstream-truncation/debugging/poc_debug`
- PoC source: `bugs/protobuf/arrayinputstream-truncation/poc/poc_real.cpp`
- Library source:
  - `targets/protobuf/src/google/protobuf/io/zero_copy_stream_impl_lite.h:55`
  - `targets/protobuf/src/google/protobuf/io/zero_copy_stream_impl_lite.cc:49-67`

## Executive Summary

`ArrayInputStream` accepts `int size` and stores it in `size_`. The PoC passes a logical size of `2147483648` (`INT_MAX + 1`), which narrows to `-2147483648` when the constructor is called. Because `position_` starts at `0`, the first `Next()` check `position_ < size_` becomes `0 < -2147483648`, which is false. The stream immediately behaves as EOF and silently discards the oversized input.

This is a logic bug, not a memory-corruption crash.

## Debugger Execution Attempts

### Attempt 1: LLDB batch mode

Command:

```bash
lldb -b -s bugs/protobuf/arrayinputstream-truncation/debugging/lldb_commands.txt \
  bugs/protobuf/arrayinputstream-truncation/debugging/poc_debug
```

Result:

```text
error: could not find 'debugserver'. Please ensure it is properly installed and available in your PATH
```

### Attempt 2: LLDB with explicit architecture

Command:

```bash
lldb --arch arm64 -b -s bugs/protobuf/arrayinputstream-truncation/debugging/lldb_commands.txt \
  bugs/protobuf/arrayinputstream-truncation/debugging/poc_debug
```

Result:

```text
error: could not find 'debugserver'. Please ensure it is properly installed and available in your PATH
```

### Attempt 3: GDB fallback

`gdb` was not installed in the environment.

### Attempt 4: Direct runtime state capture

The compiled PoC was executed directly and produced the state needed to validate the bug.

## Step-by-Step Evidence

### 1. Constructor signature causes narrowing

Source:

```cpp
ArrayInputStream(const void* data, int size, int block_size = -1);
```

Relevant implementation:

```cpp
ArrayInputStream::ArrayInputStream(const void* data, int size, int block_size)
    : data_(reinterpret_cast<const uint8_t*>(data)),
      size_(size),
      block_size_(block_size > 0 ? block_size : size),
      position_(0),
      last_returned_size_(0) {}
```

Expected:

- A logical input length larger than `INT_MAX` should either be rejected or preserved safely.

Actual:

- The constructor receives the narrowed 32-bit value and stores it directly in `size_`.

### 2. PoC drives the oversized case

The PoC defines:

```cpp
constexpr size_t kLogicalSize = static_cast<size_t>(std::numeric_limits<int>::max()) + 1;
```

Then it constructs the stream with:

```cpp
google::protobuf::io::ArrayInputStream stream(region, oversized);
```

This means the logical size is:

```text
2147483648
```

and the constructor parameter `int size` receives:

```text
-2147483648
```

### 3. First `Next()` call proves the broken state

`Next()` uses:

```cpp
if (position_ < size_) {
  ...
} else {
  last_returned_size_ = 0;
  return false;
}
```

With the truncated state:

- `position_ = 0`
- `size_ = -2147483648`

the condition becomes:

```text
0 < -2147483648
```

which is false, so the function returns EOF immediately.

### 4. Runtime output from the compiled debug PoC

Captured from `bugs/protobuf/arrayinputstream-truncation/debugging/state_output.txt`:

```text
logical_size=2147483648
int_truncated_size=-2147483648
next_result=0
returned_size=-1
byte_count=0
LOGIC_BUG: oversized input is treated as empty after int truncation
```

Interpretation:

- `logical_size=2147483648`
  - The caller intended a stream larger than `INT_MAX`.
- `int_truncated_size=-2147483648`
  - The constructor argument was narrowed into a negative signed value.
- `next_result=0`
  - `Next()` immediately returned false.
- `returned_size=-1`
  - No buffer was returned to the caller.
- `byte_count=0`
  - The stream consumed zero bytes even though the caller supplied a valid mapped region.

## Summary Table

| Check | Expected | Actual | Result |
|-------|----------|--------|--------|
| Logical input size | `2147483648` accepted safely or rejected explicitly | `2147483648` | Input is oversized |
| Constructor parameter | Preserve logical size or fail | `-2147483648` | BUG |
| First `Next()` | Return data or reject with explicit bounds error | `false` | BUG |
| Returned size | Positive byte count | `-1` | BUG |
| ByteCount | Reflect consumed bytes after `Next()` | `0` | BUG |

## Conclusion

Status: `STATE_BUG`

The incorrect runtime state is proven. A logical input size of `2147483648` is truncated to `-2147483648` when passed into `ArrayInputStream(const void*, int, int)`. The internal state then causes `Next()` to return EOF immediately, and the stream silently behaves as empty. No ASan crash occurs because the failure is a logic error in stream length handling, not an out-of-bounds access.
