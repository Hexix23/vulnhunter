# LLDB Debug Report: tokenizer_fini_null

## Build Information

- Build directory: `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/builds/protobuf-asan-arm64`
- Debug binary: `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/tokenizer_fini_null/debugging/poc_debug`
- PoC source: `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/tokenizer_fini_null/poc/poc_real.cpp`
- Compile command:

```bash
xcrun clang++ -arch arm64 $(cat builds/protobuf-asan-arm64/compile_flags.txt) -g \
  bugs/protobuf/tokenizer_fini_null/poc/poc_real.cpp \
  builds/protobuf-asan-arm64/lib/libprotobuf.a \
  -L/opt/homebrew/opt/abseil/lib \
  -labsl_log_internal_check_op -labsl_log_internal_message \
  -labsl_log_internal_nullguard -labsl_strings -labsl_strings_internal \
  -labsl_str_format_internal -labsl_base -labsl_spinlock_wait \
  -labsl_throw_delegate -labsl_raw_logging_internal \
  builds/protobuf-asan-arm64/lib/libutf8_validity.a -lpthread \
  -o bugs/protobuf/tokenizer_fini_null/debugging/poc_debug
```

## Executive Summary

`Tokenizer(nullptr, nullptr)` is not handled defensively. The constructor stores the null
`ZeroCopyInputStream*` in `input_`, then immediately calls `Refresh()`. `Refresh()` then
unconditionally dereferences `input_` via `input_->Next(&data, &buffer_size_)` at
`tokenizer.cc:275`.

This is a real state bug:

- Expected state: either reject null input before use, or keep `input_` non-null.
- Actual state: `input_ == nullptr` at constructor entry, and the code still reaches
  a virtual call on `input_`.

## Debugger Attempts

### Attempt 1: LLDB batch mode

Command file saved as `debugging/lldb_commands.txt`.

Result from `debugging/lldb_output.txt`:

```text
error: could not find 'debugserver'. Please ensure it is properly installed and available in your PATH
```

### Attempt 2: LLDB with explicit architecture

Result:

```text
error: could not find 'debugserver'. Please ensure it is properly installed and available in your PATH
```

### Attempt 3: GDB fallback

`gdb` is not installed in this environment, so there was no usable debugger fallback.

### Attempt 4: Runtime state capture fallback

Executed the debug binary directly and captured the crash in
`debugging/state_output.txt`.

## Step-by-Step Evidence

### 1. Null input is passed from the PoC

PoC excerpt:

```cpp
ZeroCopyInputStream* input = nullptr;
Tokenizer tokenizer(input, nullptr);
```

This establishes the incoming state:

| Field | Expected | Actual |
|---|---|---|
| `input` argument | valid `ZeroCopyInputStream*` or checked null | `nullptr` |

### 2. Constructor immediately enters `Refresh()`

Relevant source:

```cpp
Tokenizer::Tokenizer(ZeroCopyInputStream* input,
                     ErrorCollector* error_collector)
    : input_(input), ...
{
  ...
  Refresh();
}
```

The constructor does not validate `input` before calling `Refresh()`.

### 3. `Refresh()` dereferences the null stream pointer

Crash site:

```cpp
if (!input_->Next(&data, &buffer_size_)) {
```

Source locations:

- Constructor call site resolves to `tokenizer.cc:203`
- Inlined crash resolves to `tokenizer.cc:275`

Address resolution:

```text
xcrun atos -o debugging/poc_debug 0x1000031b0 0x100000e58
google::protobuf::io::Tokenizer::Tokenizer(...) (tokenizer.cc:203)
main (poc_real.cpp:13)
```

```text
llvm-addr2line -e debugging/poc_debug 0x1000031b0
/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/src/google/protobuf/io/tokenizer.cc:275
```

### 4. Runtime register state proves the dereference target is null

Captured from `debugging/state_output.txt`:

```text
==43387==ERROR: AddressSanitizer: SEGV on unknown address 0x000000000000
==43387==The signal is caused by a READ memory access.
==43387==Hint: address points to the zero page.
...
x[0] = 0x0000000000000000
...
SUMMARY: AddressSanitizer: SEGV (...) in google::protobuf::io::Tokenizer::Tokenizer(...)
```

Interpretation:

- `x[0] = 0` means the object pointer used for the member call is null on arm64.
- The faulting address is also `0x0`.
- That is consistent with `input_->Next(...)` executing while `input_ == nullptr`.

### 5. Destructor path is not reached in this PoC

`Tokenizer::~Tokenizer()` also dereferences `input_` if unread bytes remain:

```cpp
if (buffer_size_ > buffer_pos_) {
  input_->BackUp(buffer_size_ - buffer_pos_);
}
```

However, this PoC crashes during construction before an instance is successfully created,
so the destructor is not reached. The validated bug for this runtime is therefore the
constructor-time null dereference in `Refresh()`.

## Summary Table

| Check | Expected | Actual | Result |
|---|---|---|---|
| Constructor argument `input` | non-null or validated | `nullptr` | BUG |
| Constructor behavior | reject null or stay safe | calls `Refresh()` unconditionally | BUG |
| `Refresh()` use of `input_` | null-check before dereference | `input_->Next(...)` | BUG |
| Fault address | non-zero valid object | `0x000000000000` | BUG |
| Runtime register `x0` | valid stream object | `0x0000000000000000` | BUG |

## Conclusion

Status: `STATE_BUG`

The runtime state is incorrect and directly observable:

- The API accepts a null `ZeroCopyInputStream*`.
- The constructor stores that null pointer and immediately dereferences it.
- The fault is reproducible in the prebuilt ASan protobuf archive and resolves to
  `tokenizer.cc:275`.

This is a confirmed null-pointer state bug in constructor-time initialization, even though
LLDB itself could not attach due to the missing macOS `debugserver` component.
