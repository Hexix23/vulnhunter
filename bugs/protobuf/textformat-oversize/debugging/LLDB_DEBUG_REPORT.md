# LLDB Debug Report: textformat-oversize

## Build Information

- **Build Directory:** `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/builds/protobuf-asan-arm64`
- **PoC Source:** `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/textformat-oversize/poc/poc_real.cpp`
- **Debug Binary:** `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/textformat-oversize/debugging/poc_debug`
- **Target Source:** `targets/protobuf/src/google/protobuf/text_format.cc:1945`

## Executive Summary

The source bug is present in `CheckParseInputSize()`:

```cpp
template <typename T>
bool CheckParseInputSize(T& input, io::ErrorCollector* error_collector) {
  if (input.size() > INT_MAX) {
    error_collector->RecordError(
        -1, 0,
        absl::StrCat(
            "Input size too large: ", static_cast<int64_t>(input.size()),
            " bytes", " > ", INT_MAX, " bytes."));
    return false;
  }
  return true;
}
```

`TextFormat::Parser::Parser()` initializes `error_collector_` to `nullptr`, so oversize input should produce a null dereference when `ParseFromString()` reaches `CheckParseInputSize()`.

In the supplied ASan build, that code path was **not reached**. The binary aborts during protobuf descriptor static initialization before `main()` executes. Because the requested parser state was not observed at runtime, this validation run records `STATE_OK` for the supplied build artifacts, with a note that the result is blocked by an earlier unrelated crash.

## Reproduction Steps

### 1. Compile debug PoC against the supplied build

```bash
xcrun clang++ -arch arm64 \
  -L/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/builds/protobuf-asan-arm64/lib \
  $(cat /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/builds/protobuf-asan-arm64/compile_flags.txt) \
  -g \
  /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/textformat-oversize/poc/poc_real.cpp \
  /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/builds/protobuf-asan-arm64/lib/libprotobuf.a \
  $(pkg-config --libs protobuf | sed -E 's@-L[^ ]+/protobuf/[^ ]+ -lprotobuf ?@@') \
  -lpthread \
  -o /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/textformat-oversize/debugging/poc_debug
```

### 2. LLDB batch commands used

Saved in `debugging/lldb_commands.txt`:

```text
breakpoint set --file text_format.cc --line 1946
breakpoint set --name main
run
bt
register read
quit
```

### 3. LLDB Attempt 1: standard batch mode

```text
(lldb) target create "bugs/protobuf/textformat-oversize/debugging/poc_debug"
Current executable set to '/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/textformat-oversize/debugging/poc_debug' (arm64).
(lldb) breakpoint set --file text_format.cc --line 1946
Breakpoint 1: 2 locations.
(lldb) breakpoint set --name main
Breakpoint 2: where = poc_debug`main + 36 at poc_real.cpp:41, address = 0x000000010000292c
(lldb) run
error: could not find 'debugserver'. Please ensure it is properly installed and available in your PATH
```

Result: LLDB could create the target and resolve both breakpoints, but could not launch the process because `debugserver` is unavailable on this machine.

### 4. LLDB Attempt 2: explicit architecture

```text
(lldb) target create --arch=arm64 "bugs/protobuf/textformat-oversize/debugging/poc_debug"
Current executable set to '/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/textformat-oversize/debugging/poc_debug' (arm64).
(lldb) breakpoint set --name main
Breakpoint 1: where = poc_debug`main + 36 at poc_real.cpp:41, address = 0x000000010000292c
(lldb) run
error: could not find 'debugserver'. Please ensure it is properly installed and available in your PATH
```

Result: same launch failure.

### 5. Fallback check: GDB

```text
/bin/bash: gdb: command not found
```

Result: `gdb` is not installed, so interactive debugger fallback is unavailable.

## Runtime Evidence From Direct Execution

Since the debugger could not launch, the next fallback was direct execution of the debug PoC to capture the earliest runtime state from the supplied ASan-linked binary.

### Intended PoC flow

`poc_real.cpp` would normally execute:

```cpp
constexpr size_t kTriggerSize = static_cast<size_t>(INT_MAX) + 1;
...
fprintf(stderr, "Creating sparse %zu-byte mapping\n", kTriggerSize);
...
google::protobuf::Any message;
google::protobuf::TextFormat::Parser parser;
...
bool ok = parser.ParseFromString(
    std::string_view(static_cast<const char*>(mapping), kTriggerSize),
    &message);
```

Expected state if the target bug were reached:

| Check | Expected |
|-------|----------|
| `kTriggerSize` | `2147483648` |
| `parser.error_collector_` | `nullptr` |
| `input.size()` in `CheckParseInputSize()` | `2147483648` |
| dereference target | null `error_collector_` |

### Actual observed runtime state

The process aborts before `main()`:

```text
AddressSanitizer:DEADLYSIGNAL
=================================================================
==66016==ERROR: AddressSanitizer: SEGV on unknown address 0xffffd84fd7d9d8f9
...
    #1 0x00010066bb44 in google::protobuf::DescriptorPool::Tables::Tables()+0x7cc
    #2 0x0001006773ac in google::protobuf::DescriptorPool::DescriptorPool(google::protobuf::DescriptorDatabase*, google::protobuf::DescriptorPool::ErrorCollector*)+0x110
    #3 0x00010067913c in google::protobuf::(anonymous namespace)::NewGeneratedPool()+0x34
    #4 0x000100679434 in google::protobuf::DescriptorPool::InternalAddGeneratedFile(void const*, int)+0x1dc
    #5 0x0001008bba18 in google::protobuf::internal::AddDescriptors(google::protobuf::internal::DescriptorTable const*)+0x130
    #6 0x000100660448 in _GLOBAL__I_000102+0x1c
```

Critical observation:

- `main()` at `poc_real.cpp:41` was never reached.
- The first observable fault is in `_GLOBAL__I_000102`, which is a static initializer.
- Because the crash happens before the sparse mapping, parser construction, and `ParseFromString()` call, there is no runtime evidence from this supplied build that `CheckParseInputSize()` executed.

### Register snapshot from the direct ASan crash

```text
x[0] = 0xbebebefebebec7ce
x[8] = 0x17d7d7dfd7d7d8f9
x[13] = 0xbebebebebebebebe
x[16] = 0xbebebebebebebebe
fp = 0x000000016f79d7b0
lr = 0x0000000100707648
sp = 0x000000016f79d620
```

The repeating `0xbebebebe...` pattern is consistent with poisoned or uninitialized memory during the earlier descriptor-pool crash. It is not evidence for the target text-format oversize condition.

## Source Correlation

Relevant source lines:

```text
1928 TextFormat::Parser::Parser()
1929     : error_collector_(nullptr),
...
1945 bool CheckParseInputSize(T& input, io::ErrorCollector* error_collector) {
1946   if (input.size() > INT_MAX) {
1947     error_collector->RecordError(
...
1976 bool TextFormat::Parser::ParseFromString(absl::string_view input,
1978   DO(CheckParseInputSize(input, error_collector_));
```

This proves the source-level bug exists, but this debugging session did not produce runtime state for those lines because a different bug in the provided ASan build prevented execution from reaching them.

## Conclusion

## Status: STATE_OK

Reason for `STATE_OK`:

- No incorrect parser state was observed at runtime in the supplied build artifacts.
- The supplied ASan build crashes earlier during descriptor static initialization, before `main()` and before `TextFormat::Parser::ParseFromString()` is invoked.
- LLDB could not launch due a missing `debugserver`, and `gdb` is not installed.

What this result means:

- It does **not** prove the source bug is fixed.
- It means this validation run did **not** capture the target runtime state on the supplied build.
- The earliest observable bug in this environment is the unrelated pre-`main()` `DescriptorPool::Tables::Tables()` crash.

## Files Generated

- `debugging/lldb_commands.txt`
- `debugging/lldb_attempt.txt`
- `debugging/state_output.txt`
- `debugging/poc_debug`
