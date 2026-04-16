# LLDB Debug Report: protobuf-input-001

## Build Information

- Build directory: `builds/protobuf-asan-arm64/`
- Finding location: `targets/protobuf/upb/conformance/conformance_upb.c:268`
- Source under review: `DoTestIo()` in `conformance_upb.c`
- Runtime sink exercised: `upb_Arena_Malloc()` from `builds/protobuf-asan-arm64/lib/libupb.a`
- Debug source: `bugs/protobuf/protobuf-input-001/debugging/poc_printf.cpp`
- Debug binary: `bugs/protobuf/protobuf-input-001/debugging/poc_debug`
- LLDB commands: `bugs/protobuf/protobuf-input-001/debugging/lldb_commands.txt`
- Fallback commands: `bugs/protobuf/protobuf-input-001/debugging/printf_capture.txt`

## Executive Summary

`DoTestIo()` reads a 32-bit `input_size` from stdin and passes it directly to
`upb_Arena_Malloc(c.arena, input_size)` without any upper bound check. The
provided build bundle contains the allocator library but not the final
`conformance_upb` executable, so the runtime proof uses a stdin-driven debug
harness linked against the shipped `libupb.a` and preserves the same critical
dataflow into `upb_Arena_Malloc()`.

Rosetta detection returned no translation marker, so the required LLDB sequence
was attempted first:

1. Plain `xcrun lldb -b -s ...`
2. Ad-hoc `codesign -s - -f ...` then LLDB retry
3. `arch -arm64 /bin/bash -lc 'xcrun lldb ...'`

Each attempt resolved the arm64 target and both breakpoints, then failed at
`run` with `error: process exited with status -1 (no such process)`. The final
state evidence therefore comes from the required printf fallback.

## Relevant Source Flow

```c
if (!CheckedRead(STDIN_FILENO, &input_size, sizeof(uint32_t))) {
  return false;
}

c.symtab = symtab;
c.arena = upb_Arena_New();
input = upb_Arena_Malloc(c.arena, input_size);
```

The fallback harness reads the same 32-bit value from stdin, stores it in
`input_size`, and passes that unchanged value to the same allocator symbol from
the shipped library.

## LLDB Attempt Evidence

### Attempt 1: plain LLDB

```text
(lldb) target create "bugs/protobuf/protobuf-input-001/debugging/poc_debug_current"
Current executable set to '/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/protobuf-input-001/debugging/poc_debug_current' (arm64).
(lldb) command source -s 0 '/tmp/protobuf_input_001_lldb_commands_current.txt'
Executing commands in '/tmp/protobuf_input_001_lldb_commands_current.txt'.
(lldb) breakpoint set --file poc_printf.cpp --line 28
Breakpoint 1: where = poc_debug_current`<+380> [inlined] upb_Arena_New at poc_printf.cpp:28:22, address = 0x00000001000028dc
(lldb) breakpoint set --file poc_printf.cpp --line 42
Breakpoint 2: where = poc_debug_current`main + 520 at poc_printf.cpp:42:16, address = 0x0000000100002968
(lldb) run < bugs/protobuf/protobuf-input-001/debugging/lldb_input_current.bin
error: process exited with status -1 (no such process)
```

### Attempt 2: codesigned retry

The same binary was ad-hoc signed with `codesign -s - -f` and retried. LLDB
again failed at `run` with `error: process exited with status -1 (no such
process)`.

### Attempt 3: `arch -arm64` retry

The launch was retried under `arch -arm64 /bin/bash -lc`. LLDB again failed at
`run` with `error: process exited with status -1 (no such process)`.

## Step-by-Step Runtime Evidence

### 1. The hostile stdin length is preserved as `input_size`

```text
=== STATE CAPTURE: protobuf-input-001 ===
[INPUT] bytes_read = 4
[INPUT] advertised input_size = 4294967295 (0xffffffff)
[INPUT] requested bytes ~= 4.00 GiB
```

The attacker-controlled frame length arrives intact as the maximum 32-bit
unsigned value.

### 2. The allocator sink is reached with no bound check

```text
[BEFORE] arena = 0x613000000590
[BEFORE] about_to_call = upb_Arena_Malloc(arena, 4294967295)
```

This is the bug condition in runtime form: no rejection or capping happens
between the stdin read and the allocator call.

### 3. The oversized request is accepted

```text
[AFTER] ptr = 0x300004810
[AFTER] accounted = 4294967712 (0x1000001a0)
[AFTER] fused_count = 1
```

The allocator returns a non-NULL pointer and the arena accounts for
`4294967712` bytes, confirming that the request was not rejected as oversized.

### 4. The returned span is writable across the requested range

```text
[TOUCH] first byte @ 0x300004810 = 0x41
[TOUCH] last byte  @ 0x40000480e = 0x5a
[RESULT] STATE_BUG: untrusted 32-bit length reached upb_Arena_Malloc() unchecked and produced a writable allocation/accounting span of 4294967712 bytes
```

Writing both the first and last requested bytes shows that the returned span
covers the full attacker-selected range. This is a logic and resource-exhaustion
bug even though no ASan crash is required.

## Summary Table

| Check | Expected safe behavior | Actual | Result |
|---|---|---|---|
| `input_size` from stdin | reject or cap | `4294967295` | **BUG** |
| Call to `upb_Arena_Malloc()` | blocked before sink | sink reached directly | **BUG** |
| Allocation result | `NULL` or fail-fast | non-NULL pointer | **BUG** |
| Arena accounting | bounded | `4294967712` bytes | **BUG** |
| Writable span | not available | first and last byte writable | **BUG** |

## Conclusion

Status: `STATE_BUG`

The runtime evidence confirms the finding. A peer-controlled 32-bit stdin
length flows unchanged into `upb_Arena_Malloc()` with no upper bound
enforcement, producing a multi-gigabyte writable arena allocation/accounting
span before protobuf parsing begins.
