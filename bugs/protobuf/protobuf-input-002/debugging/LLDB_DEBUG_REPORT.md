# LLDB Debug Report: protobuf-input-002

## Build Information

- Build directory: `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/builds/protobuf-asan-arm64`
- Debug harness: `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/protobuf-input-002/debugging/poc_debug.cpp`
- Debug binary: `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/protobuf-input-002/debugging/poc_debug`
- Compile command:

```bash
xcrun clang++ $(cat builds/protobuf-asan-arm64/compile_flags.txt) \
  -I/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf \
  -I/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/upb \
  -g bugs/protobuf/protobuf-input-002/debugging/poc_debug.cpp \
  builds/protobuf-asan-arm64/lib/libupb.a \
  $(cat builds/protobuf-asan-arm64/link_flags.txt) \
  -o bugs/protobuf/protobuf-input-002/debugging/poc_debug
```

## Executive Summary

This finding is a real state bug in the inline helper `upb_String_Append()` at `targets/protobuf/upb/io/string.h:87-92`.
The harness initializes `s.size_` to `SIZE_MAX - 3` and appends 8 bytes.
That makes `s->size_ + size` wrap to `4`, so the reserve check is skipped and the copy destination becomes `storage - 4`.

LLDB could not single-step the process on this host because `debugserver` is unavailable, even after codesigning and retrying with `--arch arm64`.
The required fallback run still captures the critical state values and ASan/UBSan show the resulting out-of-bounds write.

## Debugger Retry Results

### Attempt 1: LLDB batch mode

```text
(lldb) run
error: could not find 'debugserver'. Please ensure it is properly installed and available in your PATH
```

### Attempt 2: Codesigned LLDB retry

`codesign -s - -f ./poc_debug` completed, but LLDB failed with the same `debugserver` error.

### Attempt 3: Explicit architecture

```text
/opt/homebrew/opt/llvm/bin/lldb --arch arm64 -b -s lldb_commands.txt ./poc_debug
...
(lldb) run
error: could not find 'debugserver'. Please ensure it is properly installed and available in your PATH
```

### Attempt 4: GDB fallback

`gdb` is not installed on this system.

### Attempt 5: State-capture fallback

Executed:

```bash
ASAN_OPTIONS=detect_leaks=0:abort_on_error=0 ./poc_debug
```

This succeeded in proving the bad runtime state.

## Step-by-Step Evidence

### 1. Wrapped arithmetic before `upb_String_Append()`

```text
before.size=18446744073709551612
append.size=8
wrapped.sum=4
reserve.branch=0
wrapped.new_cap=9
storage.addr=0x16d6cdf10
copy.dest=0x16d6cdf0c
copy.dest_delta=-4
```

Interpretation:

- `before.size` is `SIZE_MAX - 3`
- `append.size` is `8`
- `wrapped.sum=4` proves `s->size_ + size` overflowed
- `reserve.branch=0` proves the capacity growth path was bypassed
- `copy.dest_delta=-4` proves the future `memcpy` destination points 4 bytes before `storage`

### 2. UBSan catches the wrapped pointer calculation at `string.h:92`

```text
/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/upb/io/string.h:92:19: runtime error: addition of unsigned offset to 0x00016d6cdf10 overflowed to 0x00016d6cdf0c
SUMMARY: UndefinedBehaviorSanitizer: undefined-behavior /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/upb/io/string.h:92:19
```

This is the precise "aha" moment: pointer arithmetic on `s->data_ + s->size_` wrapped backward from `0x...df10` to `0x...df0c`.

### 3. ASan confirms the invalid write

```text
==22183==ERROR: AddressSanitizer: stack-buffer-overflow on address 0x00016d6cdf0c
WRITE of size 8 at 0x00016d6cdf0c thread T0
    #0 __asan_memcpy
    #1 upb_String_Append+0x108
    #2 main+0x41c
```

Even though ASan labels it as a stack-buffer-overflow, the key state evidence is the same:
the destination pointer is outside the valid `storage` object because the size arithmetic wrapped first.

### 4. Object layout proves the destination is outside `storage`

```text
Address 0x00016d6cdf0c is located in stack of thread T0 at offset 44 in frame
    #0 main+0xc

  This frame has 4 object(s):
    [48, 64) 'storage' (line 14) <== Memory access at offset 44 partially underflows this variable
    [80, 112) 's' (line 15)
    [144, 153) 'payload' (line 16)
```

`storage` begins at offset `48`, but the write lands at offset `44`.
That matches `copy.dest_delta=-4`.

## Summary Table

| Check | Expected | Actual | Result |
|-------|----------|--------|--------|
| `s->size_ + size` | Large positive value without wrap | `4` | BUG |
| Reserve branch | `true` for huge append | `0` | BUG |
| Copy destination | `storage` or later | `storage - 4` | BUG |
| Write result | In-bounds append | ASan write outside object | BUG |

## Conclusion

Status: `STATE_BUG`

Incorrect runtime state was observed directly:

- integer wrap changed the computed append size to `4`
- the reserve check was bypassed
- the computed destination pointer moved 4 bytes before the backing buffer
- `upb_String_Append()` then issued an invalid 8-byte write

LLDB itself could not run to completion on this machine because `debugserver` is missing, but the mandated fallback path produced sufficient forensic evidence to validate the bug.
