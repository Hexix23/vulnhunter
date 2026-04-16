# LLDB Debug Report: tokenizer_error_swallow

## Build Information

- Build directory: `builds/protobuf-asan-arm64`
- Debug target: `bugs/protobuf/tokenizer_error_swallow/debugging/poc_debug`
- Primary debugger plan: `bugs/protobuf/tokenizer_error_swallow/debugging/lldb_commands.txt`
- LLDB result: launch blocked on this host because `debugserver` is unavailable
- Fallback used: instrumented state-capture PoC in `bugs/protobuf/tokenizer_error_swallow/debugging/poc_state_capture.cpp`

## Executive Summary

This is a logic bug, not a crashing memory bug.

When `ZeroCopyInputStream::Next()` immediately fails:

1. `Tokenizer::Refresh()` sets `read_error_ = 1`, `buffer_size_ = 0`, `current_char_ = '\0'`
2. `Tokenizer` records no error through `ErrorCollector`
3. `Tokenizer::Next()` returns end-of-input state rather than a reported read failure
4. `Parser::Parse()` accepts that state as an empty proto file and returns success

The incorrect state is observable at runtime:

- tokenizer stream failure occurred
- tokenizer internal read error is set
- tokenizer collector error count remains `0`
- parser returns `ok=1`
- parser keeps `had_errors_=0`
- parser internally defaults syntax to `proto2`
- output `FileDescriptorProto.syntax()` remains empty

That combination proves the read failure was swallowed.

## LLDB Attempt Log

### Attempt 1

```text
lldb -b -s debugging/lldb_commands.txt debugging/poc_debug
error: could not find 'debugserver'. Please ensure it is properly installed and available in your PATH
```

### Attempt 2

```text
codesign -s - -f debugging/poc_debug
lldb --arch arm64 -b -s debugging/lldb_commands.txt debugging/poc_debug
error: could not find 'debugserver'. Please ensure it is properly installed and available in your PATH
```

### Attempt 3

`gdb` was not available on this host.

### Attempt 4

Used the required fallback state-capture binary to print the exact internal values LLDB was meant to inspect.

## Step-by-Step Evidence

### 1. Tokenizer constructor state after immediate stream failure

Source point: `tokenizer.cc:258-280` inside `Tokenizer::Refresh()`

```text
[TOKENIZER_CTOR] stream_failed=1 calls=1 read_error=1 buffer_size=0 current_type=0 current_char=0x00 collector_errors=0
```

Interpretation:

- `stream_failed=1`: the underlying stream reported failure
- `calls=1`: tokenizer already consumed the failing `Next()` call during construction
- `read_error=1`: tokenizer recognized a failed read internally
- `buffer_size=0` and `current_char=0x00`: tokenizer converted that failure into end-of-input state
- `collector_errors=0`: no tokenizer error was surfaced

Expected for a read failure: collector should record an input error.

Actual: internal failure state exists, but no error is reported.

### 2. Tokenizer::Next() converts the failure into a normal TYPE_END state

Source point: `tokenizer.cc:608-647`

```text
[TOKENIZER_NEXT] next=0 stream_failed=1 calls=1 read_error=1 current_type=1 previous_type=0 current_char=0x00 collector_errors=0
tokenizer_errors=0
tokenizer_warnings=0
```

Interpretation:

- `next=0`: caller sees no next token
- `current_type=1`: tokenizer moved into end token state
- `previous_type=0`: transition was from `TYPE_START` to `TYPE_END`
- `collector_errors=0`: still no tokenizer error despite the failed stream

Expected for failed I/O: error path.

Actual: silent EOF-like state.

### 3. Parser accepts the failed tokenizer as a valid empty file

Source point: `parser.cc:621-685`

Before parse:

```text
[PARSER_BEFORE] stream_failed=1 calls=1 tokenizer_read_error=1 tokenizer_current_type=0 parser_had_errors=0 syntax='' parser_errors=0
```

After parse:

```text
[PARSER_AFTER] ok=1 stream_failed=1 calls=1 tokenizer_read_error=1 tokenizer_current_type=1 parser_had_errors=0 syntax='proto2' message_types=0 parser_errors=0
[FILE_STATE] file_name='failing.proto' file_syntax=''
parser_errors=0
parser_warnings=0
```

Interpretation:

- parser entered with an already-failed tokenizer: `tokenizer_read_error=1`
- parser still returned `ok=1`
- parser kept `had_errors=0`
- parser internally defaulted `syntax` to `proto2`
- descriptor output remained semantically empty: `file_syntax=''`
- no parser errors or warnings were recorded through the collector

This is the bug: failed input is normalized into successful parsing of an empty file.

## Summary Table

| Check | Expected | Actual | Result |
|---|---|---|---|
| Underlying stream result | read failure | `stream_failed=1` | OK |
| Tokenizer internal state | failure recorded and surfaced | `read_error=1` | Internal failure observed |
| Tokenizer error collector | at least 1 error | `0` | BUG |
| Tokenizer visible token state | explicit read failure | `TYPE_END` | BUG |
| Parser return value | `false` | `ok=1` | BUG |
| Parser had_errors_ | `true` | `0` | BUG |
| File syntax field | explicit failure or syntax error | empty string | BUG |

## Conclusion

Status: `STATE_BUG`

The runtime state proves a real logic defect:

- a transport/input failure happened
- tokenizer internal failure state was set
- no error was emitted
- parser treated the failed read as a clean empty file

This is evidence of silent error swallowing, not memory corruption.
