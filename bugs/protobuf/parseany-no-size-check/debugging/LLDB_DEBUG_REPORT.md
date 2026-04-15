# LLDB Debug Report: parseany-no-size-check

## Build Information

- Build directory provided: `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/builds/protobuf-asan-arm64`
- Debug binary used for state capture: `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/parseany-no-size-check/debugging/poc_debug`
- Debug source: `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/parseany-no-size-check/debugging/parseany_state_capture.cpp`
- Target code: `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/src/google/protobuf/json/internal/parser.cc`

## Status

`STATE_BUG`

## Executive Summary

`google::protobuf::json_internal::ParseAny()` explicitly buffers the entire JSON object so it can search for `@type` and then reparse the buffered bytes through a fresh `JsonLexer`. There is no size check between the first pass and the replay path.

Native LLDB validation could not reach breakpoints on this host because `debugserver` is unavailable. Per the required fallback chain, I retried with codesigning, retried with explicit `arm64`, tried `gdb`, and then used direct state capture from an instrumented debug binary. The fallback output still proves the logic bug: `mark.value.UpToUnread()` captured the full 16 MiB object, replay of that full buffer succeeded, and parsing completed while resident memory increased by another 47.12 MiB.

## Vulnerable Code

At `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/src/google/protobuf/json/internal/parser.cc`, `ParseAny()` contains the following logic:

1. `auto mark = lex.BeginMark();`
2. `lex.VisitObject(...)` scans the whole object searching for `@type`.
3. `absl::string_view any_text = mark.value.UpToUnread();`
4. `JsonLexer any_lex(&in, lex.options(), &lex.path(), mark.loc);`
5. `ParseMessage<Traits>(any_lex, desc, msg, /*any_reparse=*/true);`

This means the whole object is retained and then reparsed, with no object-size guard before the second parse.

## Debugger Attempt History

### Attempt 1: LLDB batch mode

Command:

```bash
lldb -b -s bugs/protobuf/parseany-no-size-check/debugging/lldb_commands.txt \
  bugs/protobuf/parseany-no-size-check/debugging/poc_debug
```

Result:

```text
error: could not find 'debugserver'. Please ensure it is properly installed and available in your PATH
```

### Attempt 2: Codesign and retry LLDB

Command:

```bash
codesign -s - -f bugs/protobuf/parseany-no-size-check/debugging/poc_debug
lldb -b -s bugs/protobuf/parseany-no-size-check/debugging/lldb_commands.txt \
  bugs/protobuf/parseany-no-size-check/debugging/poc_debug
```

Result: same `debugserver` failure.

### Attempt 3: LLDB with explicit architecture

Command:

```bash
lldb --arch arm64 -b -s bugs/protobuf/parseany-no-size-check/debugging/lldb_commands.txt \
  bugs/protobuf/parseany-no-size-check/debugging/poc_debug
```

Result: same `debugserver` failure.

### Attempt 4: GDB fallback

Result:

```text
DW_FORM_GNU_str_index or DW_FORM_strx used without .debug_str section ...
```

`gdb` could not consume the generated debug info for this binary, so live stepping was still unavailable.

## Fallback State Evidence

The instrumented debug binary was run directly:

```bash
bugs/protobuf/parseany-no-size-check/debugging/poc_debug 16
```

Observed output:

```text
Generated Any JSON payload bytes: 16777364
Captured type_url: type.googleapis.com/google.protobuf.FileDescriptorSet
Captured type_url bytes: 53
mark.value.UpToUnread() bytes: 16777364
mark covers entire input: true
mark prefix ascii: {"@type":"type.googleapis.com/go
mark suffix ascii: "audit.pkg","syntax":"proto3"}]}
mark prefix hex: 7b 22 40 74 79 70 65 22 3a 22 74 79 70 65 2e 67
mark suffix hex: 74 61 78 22 3a 22 70 72 6f 74 6f 33 22 7d 5d 7d
replay lexer SkipToToken: OK
Resident memory before parse: 61325312 (58.48 MiB)
Resident memory after parse: 110739456 (105.61 MiB)
Resident memory delta: 49414144 (47.12 MiB)
JsonStringToMessage status: OK
Parsed embedded value bytes: 15286215
```

## Step-by-Step Interpretation

### 1. The mark captured the entire object

- Expected for a safe bounded parser: large `Any` objects should be rejected or size-limited before reparsing.
- Actual: `mark.value.UpToUnread() bytes: 16777364`
- Actual: `mark covers entire input: true`

This is the key state bug. The replay buffer is not a small field slice; it is the whole 16 MiB object.

### 2. The replay parser accepted the full captured buffer

- Actual: `replay lexer SkipToToken: OK`

That confirms the second lexer is created over the entire marked object and is immediately usable for reparse.

### 3. Parsing succeeds after full buffering and replay

- Actual: `JsonStringToMessage status: OK`
- Actual: `Parsed embedded value bytes: 15286215`

So the oversized object is not only buffered; it is fully accepted and materialized into `Any.value`.

### 4. Memory growth proves additional parse-time amplification

- Payload bytes: `16777364` (`~16.00 MiB`)
- Resident memory delta: `49414144` (`47.12 MiB`)

The process retained substantially more memory than the input size while handling this object. That is consistent with the implementation buffering the original object and constructing parsed output from it.

## Summary Table

| Check | Expected | Actual | Result |
|-------|----------|--------|--------|
| `@type` scan buffer | bounded or rejected | full object buffered | **BUG** |
| `mark.value.UpToUnread().size()` | less than whole input or blocked | `16777364` | **BUG** |
| `mark covers entire input` | `false` for guarded path | `true` | **BUG** |
| replay lexer | blocked on size limit | `OK` | **BUG** |
| parse result | reject oversized object before reparse | `OK` | **BUG** |
| memory growth | modest / bounded | `47.12 MiB` for a `16 MiB` payload | **BUG** |

## Conclusion

This finding is validated as a logic/state bug. Even without a crashing sanitizer report, the observed runtime state is incorrect:

- `ParseAny()` buffers the entire `Any` JSON object.
- The buffered object is reparsed without a size check.
- The replay path succeeds and materializes a large embedded value.
- Resident memory grows well beyond the input size during the operation.

That is sufficient evidence for `STATE_BUG`.
