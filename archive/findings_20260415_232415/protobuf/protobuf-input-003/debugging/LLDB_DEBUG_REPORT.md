# LLDB Debug Report: protobuf-input-003

## Build Information

- Build directory: `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/builds/protobuf-asan-arm64`
- Debug binary: `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/protobuf-input-003/debugging/poc_debug`
- PoC source: `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/protobuf-input-003/poc/poc_real.cpp`
- Method used: `printf` fallback after LLDB launch failure

## Debugger Attempts

Rosetta check returned no translated-process marker, and `uname -m` reported `arm64`, so the target was treated as a native ARM64 run rather than a Rosetta session.

Native LLDB attempt:

```text
(lldb) target create "bugs/protobuf/protobuf-input-003/debugging/poc_debug"
(lldb) breakpoint set --name SimulateReserveNarrowing
Breakpoint 1: where = poc_debug`(anonymous namespace)::SimulateReserveNarrowing(...) + 16 at poc_real.cpp:37:27
(lldb) run
error: process exited with status -1 (no such process)
```

`arch -arm64` retry:

```text
(lldb) target create "bugs/protobuf/protobuf-input-003/debugging/poc_debug"
(lldb) breakpoint set --name SimulateReserveNarrowing
Breakpoint 1: where = poc_debug`(anonymous namespace)::SimulateReserveNarrowing(...) + 16 at poc_real.cpp:37:27
(lldb) run
error: process exited with status -1 (no such process)
```

Because both LLDB launch paths failed before the process started, runtime state was captured with the instrumented PoC at [poc_real.cpp](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/protobuf-input-003/poc/poc_real.cpp#L34) mirroring the vulnerable arithmetic in [required_fields.c](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/upb/util/required_fields.c#L168).

## Executive Summary

`upb_FieldPathVector_Reserve()` stores allocation byte counts in `int` even though `vec->cap` is `size_t`. The captured state proves two distinct truncations:

- `2147483648 (0x80000000)` narrows to `-2147483648`
- `4294967296 (0x100000000)` narrows to `0`

That means the values handed to `upb_grealloc()` no longer match the actual byte counts implied by the vector capacity growth.

## Step-by-Step Evidence

### 1. Reserve arithmetic before the allocator call

From `debugging/printf_state_output.txt`:

```text
=== CHECKPOINT: upb_FieldPathVector_Reserve narrowing ===
[STATE] entry_size = 16
[STATE] initial_cap = 134217728
[STATE] initial_size = 134217728
[STATE] elems = 1
[STATE] raw_oldsize = 2147483648 (0x80000000)
[STATE] oldsize_as_int = -2147483648 (0x80000000)
[STATE] need = 134217729
[STATE] grown_cap = 268435456
[STATE] raw_newsize = 4294967296 (0x100000000)
[STATE] newsize_as_int = 0 (0x0)
[RESULT] BUG: size_t to int narrowing corrupts allocation size
```

Interpretation:

| Check | Expected from `size_t` math | Actual stored in `int` | Result |
|-------|-----------------------------|-------------------------|--------|
| `oldsize` | `2147483648` | `-2147483648` | **BUG** |
| `newsize` | `4294967296` | `0` | **BUG** |

The arithmetic in [poc_real.cpp](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/protobuf-input-003/poc/poc_real.cpp#L46) to [poc_real.cpp](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/protobuf-input-003/poc/poc_real.cpp#L55) matches the production helper in [required_fields.c](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/upb/util/required_fields.c#L171) to [required_fields.c](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/upb/util/required_fields.c#L177).

### 2. Real library-backed trigger still reaches the vulnerable helper

The same `poc_debug 11 4` run then entered the real library path and ASan aborted inside `upb_FieldPathVector_Reserve()`:

```text
==5373==ERROR: AddressSanitizer: requested allocation size 0xffffffff80000000
    #1 0x0001015a4028 in upb_FieldPathVector_Reserve+0x230
    #2 0x0001015a3010 in upb_util_FindUnsetRequiredInternal+0x238
    #14 0x0001015a2a64 in upb_util_HasUnsetRequired+0x11c
    #15 0x000100f23698 in main+0xd58
```

This ties the state capture to the actual compiled target, not just to a synthetic arithmetic example.

### 3. Trigger shape observed at runtime

The fresh run also reported:

```text
depth=11 breadth=4
sizeof(upb_FieldPathEntry)=16
entries_to_cross_INT_MAX=134217727
node_count=5592405
```

These values explain why the path vector growth reaches the signed-`int` boundary for `newsize`.

## Conclusion

Status: `STATE_BUG`

The runtime evidence shows incorrect internal state before allocation:

- `raw_oldsize` is valid as `size_t` but becomes a negative `int`
- `raw_newsize` is valid as `size_t` but becomes zero as `int`

This is direct proof of the narrowing bug described in the finding, and the real harness reaches the corresponding allocator call in the built `libupb.a` path.
