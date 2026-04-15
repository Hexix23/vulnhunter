# LLDB Debug Report: protobuf-001

## Build Information

- Build directory: `builds/protobuf-asan-arm64`
- Debug binary: `bugs/protobuf/protobuf-001/debugging/poc_debug`
- PoC source: `bugs/protobuf/protobuf-001/poc/poc_real.cpp`
- Compile method: reused the prebuilt ASan archives from `builds/protobuf-asan-arm64/` and the proven fallback link set from `poc/build_real.sh`

## Executive Summary

The prebuilt protobuf ASan artifact does not reach the finding path in `google/protobuf/json/internal/parser.cc:1039`.
The binary aborts before `main()` during protobuf descriptor registration, inside `google::protobuf::DescriptorPool::Tables::Tables()`.

Because execution never reaches `JsonStringToMessage()` or `ParseAny()`, LLDB could not capture finding-specific runtime state such as:

- buffered `Any` object size
- `mark.value.UpToUnread()` length
- reparse state in the second `JsonLexer`

The observed runtime state is therefore **not evidence of protobuf-001 triggering**. The correct finding result for this runtime session is `STATE_OK` for the target state, with a note that validation is blocked by an unrelated initialization-time crash in the supplied build artifact.

## Reproduction Commands

### Build debug PoC

```bash
ABSL_ALL_DYLIBS="$(printf '%s ' /opt/homebrew/opt/abseil/lib/libabsl*.dylib)"
xcrun clang++ -arch arm64 $(cat builds/protobuf-asan-arm64/compile_flags.txt) -g \
  bugs/protobuf/protobuf-001/poc/poc_real.cpp \
  -Lbuilds/protobuf-asan-arm64/lib \
  builds/protobuf-asan-arm64/lib/libprotobuf.a \
  builds/protobuf-asan-arm64/lib/libutf8_validity.a \
  $ABSL_ALL_DYLIBS -lpthread -lc++ -lz -framework CoreFoundation \
  -o bugs/protobuf/protobuf-001/debugging/poc_debug
```

### Intended LLDB batch run

```bash
codesign -s - -f bugs/protobuf/protobuf-001/debugging/poc_debug 2>/dev/null || true
lldb -b -s bugs/protobuf/protobuf-001/debugging/lldb_commands.txt \
  bugs/protobuf/protobuf-001/debugging/poc_debug
```

## Debugger Attempt Log

### Attempt 1: LLDB batch mode

Command:

```bash
lldb -b -s /tmp/protobuf001_lldb_test.txt bugs/protobuf/protobuf-001/debugging/poc_debug
```

Result:

```text
error: could not find 'debugserver'. Please ensure it is properly installed and available in your PATH
```

### Attempt 2: codesigned binary + LLDB

Command:

```bash
codesign -s - -f bugs/protobuf/protobuf-001/debugging/poc_debug
lldb -b -s /tmp/protobuf001_lldb_test.txt bugs/protobuf/protobuf-001/debugging/poc_debug
```

Result:

```text
bugs/protobuf/protobuf-001/debugging/poc_debug: replacing existing signature
error: could not find 'debugserver'. Please ensure it is properly installed and available in your PATH
```

### Attempt 3: explicit-arch LLDB

Command:

```bash
lldb --arch arm64 -b -s /tmp/protobuf001_lldb_test.txt bugs/protobuf/protobuf-001/debugging/poc_debug
```

Result:

```text
error: could not find 'debugserver'. Please ensure it is properly installed and available in your PATH
```

### Attempt 4: GDB fallback

Command:

```bash
command -v gdb
```

Result:

```text
gdb=missing
```

### Attempt 5: direct state capture fallback

Command:

```bash
./bugs/protobuf/protobuf-001/debugging/poc_debug
```

Result: the binary aborts before `main()` with the same initialization-time ASan trace previously recorded for the non-debug PoC.

## Runtime Evidence Collected

### 1. Expected execution point

For protobuf-001, the intended runtime observation point was:

```text
google::protobuf::json_internal::ParseAny(...)
targets/protobuf/src/google/protobuf/json/internal/parser.cc:1039
```

This function was never reached.

### 2. Actual first failing path

Direct execution consistently fails in:

```text
google::protobuf::DescriptorPool::Tables::Tables()
google::protobuf::DescriptorPool::InternalAddGeneratedFile(void const*, int)
google::protobuf::internal::AddDescriptors(...)
_GLOBAL__I_000102
```

This all happens before `main()`.

### 3. Concrete incorrect state observed at crash time

ASan register dump from `poc_debug`:

```text
x[0]  = 0xbebebefebebec6ce
x[13] = 0xbebebebebebebebe
x[16] = 0xbebebebebebebebe
pc     = 0x0001043fd9f8
lr     = 0x00000001043fd980
```

The repeating `0xbebebebe...` pattern is ASan poison, indicating that the initializer path is reading invalid/uninitialized state while building descriptor tables. This is real bad state, but it is not the state expected for protobuf-001.

### 4. Stack trace proving pre-main failure

```text
#0  std::__1::pair<...>::find_or_prepare_insert_large<...> + 0x194
#1  google::protobuf::DescriptorPool::Tables::Tables() + 0x7cc
#2  google::protobuf::DescriptorPool::DescriptorPool(...) + 0x110
#3  google::protobuf::(anonymous namespace)::NewGeneratedPool() + 0x34
#4  google::protobuf::DescriptorPool::InternalAddGeneratedFile(void const*, int) + 0x1dc
#5  google::protobuf::internal::AddDescriptors(...) + 0x130
#6  _GLOBAL__I_000102 + 0x1c
#7  dyld initializer path
```

### 5. Aha moment

Expected:

```text
Program starts -> main() -> BuildLargeAnyJson() -> JsonStringToMessage() -> ParseAny()
```

Actual:

```text
dyld initializers -> DescriptorPool::Tables::Tables() -> ASan SEGV -> abort
```

That mismatch means no runtime evidence for the reported `ParseAny()` buffering bug could be captured from this build.

## Finding-Specific Assessment

| Check | Expected for bug validation | Actual | Result |
|-------|-----------------------------|--------|--------|
| Reach `main()` | Yes | No | blocked |
| Reach `JsonStringToMessage()` | Yes | No | blocked |
| Reach `ParseAny()` | Yes | No | blocked |
| Observe oversized buffered Any object | Yes | No | blocked |
| Observe unrelated invalid state in initializer | No | Yes (`0xbebebebe...`) | unrelated |

## Conclusion

The supplied prebuilt protobuf ASan build is not debuggable to the finding site on this host:

- LLDB cannot launch because `debugserver` is unavailable.
- GDB is not installed.
- Direct execution shows the binary aborts before `main()`.

The only runtime state captured is an unrelated initialization-time failure in protobuf descriptor registration. Since the target bug state in `ParseAny()` was not observed, the result for this validation pass is:

```text
STATE_OK
```

This should be read narrowly: **state looked OK for protobuf-001 only because the program never reached the vulnerable path**. It is not evidence that the source-level logic concern in `ParseAny()` is fixed.
