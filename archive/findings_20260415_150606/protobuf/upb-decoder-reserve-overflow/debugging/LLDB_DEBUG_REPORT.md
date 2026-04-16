# LLDB Debug Report: upb-decoder-reserve-overflow

## Build Information

- Build directory: `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/builds/protobuf-asan-arm64`
- Debug binary: `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/upb-decoder-reserve-overflow/debugging/poc_debug`
- PoC source: `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/upb-decoder-reserve-overflow/poc/poc_real.cpp`
- Linked against prebuilt libraries from `builds/protobuf-asan-arm64/lib/`

## Executive Summary

This finding did not reproduce as a bad runtime state on the provided arm64 ASan build.

The packed `fixed32` decode path in `targets/protobuf/upb/wire/decode.c` receives a payload length of `8,388,608` bytes, derives `count = 2,097,152`, reserves exactly that many elements, and finishes with:

- `decode_status = Ok`
- `parsed_count = 2,097,152`
- `capacity = 2,097,152`

No negative size, wraparound, or impossible capacity was observed. The state is consistent with the source-level reserve math.

## Breakpoints Prepared

The reproducible LLDB script is saved in:

- `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/upb-decoder-reserve-overflow/debugging/lldb_commands.txt`

It targets:

- `decode.c:289` at `count = val->size >> lg2`
- `decode.c:291` at `_upb_Decoder_Reserve(d, arr, count)`
- `array.c:162` at `new_capacity = max(capacity, 4)`
- `decode.c:294` after `arr->size += count`

## Debugger Execution Status

LLDB itself could not launch the inferior in this environment because `debugserver` was not usable from the host configuration. Three launch attempts were made:

1. `lldb -b -s lldb_commands.txt ./poc_debug`
2. same after ad hoc codesigning the binary
3. `lldb --arch arm64 ...` with the LLDB framework `debugserver` directory added to `PATH`

All failed before process start. The captured launcher output is saved in:

- `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/upb-decoder-reserve-overflow/debugging/lldb_output.txt`

Because LLDB was blocked by the environment, the final evidence below uses direct runtime state from the debug binary plus source-correlated arithmetic for the same input.

## Runtime Evidence

Command:

```bash
ASAN_OPTIONS=detect_leaks=0:abort_on_error=0 \
  bugs/protobuf/upb-decoder-reserve-overflow/debugging/poc_debug 2097152
```

Observed stderr:

```text
payload_bytes=8388613 elem_count=2097152
decode_status=0 (Ok)
parsed_count=2097152 capacity=2097152
```

## Source-Correlated State Reconstruction

Relevant code:

- `targets/protobuf/upb/wire/decode.c:289`
- `targets/protobuf/upb/wire/decode.c:291`
- `targets/protobuf/upb/message/array.c:162-183`

### 1. Packed payload length and element count

For the PoC input:

- `elem_count = 2,097,152`
- each packed element is `sizeof(uint32_t) = 4`
- packed field body length = `2,097,152 * 4 = 8,388,608` bytes
- encoded message length = `1` tag byte + `4` varint-length bytes + `8,388,608` data bytes = `8,388,613`

This matches the observed runtime line:

```text
payload_bytes=8388613 elem_count=2097152
```

At `decode.c:289`:

```c
size_t count = val->size >> lg2;
```

For this field:

- `val->size = 8,388,608`
- `lg2 = 2`
- `count = 8,388,608 >> 2 = 2,097,152`

Expected state:

| Field | Expected value |
|-------|----------------|
| `val->size` | `8,388,608` |
| `lg2` | `2` |
| `count` | `2,097,152` |

### 2. Reserve check

At `decode.c:105-112`:

```c
bool need_realloc =
    arr->capacity - arr->size < elem;
if (need_realloc && !_upb_Array_Realloc(arr, arr->size + elem, &d->arena)) {
  ...
}
```

For a newly created repeated field array:

- initial `arr->size = 0`
- initial `arr->capacity = 0`
- `elem = count = 2,097,152`

So:

- `arr->capacity - arr->size = 0`
- `0 < 2,097,152` => `need_realloc = true`
- `min_capacity = arr->size + elem = 2,097,152`

No negative or wrapped value appears in this expression for the exercised input.

### 3. Reallocation growth math

At `array.c:162-183`:

```c
size_t new_capacity = UPB_MAX(array->capacity, 4);
while (new_capacity < min_capacity) {
  if (upb_ShlOverflow(&new_capacity, 1)) {
    new_capacity = SIZE_MAX;
    break;
  }
}
size_t new_bytes = new_capacity;
if (upb_ShlOverflow(&new_bytes, lg2)) return false;
```

Starting from zero capacity:

- initial `new_capacity = max(0, 4) = 4`
- doubling sequence:
  `4 -> 8 -> 16 -> ... -> 1,048,576 -> 2,097,152`
- loop stops exactly at `2,097,152`
- `new_bytes = 2,097,152 << 2 = 8,388,608`

This value fits comfortably in `size_t` on arm64. No shift overflow should trigger here.

### 4. Post-reserve array state

At `decode.c:294`:

```c
arr->size += count;
```

If reserve succeeded:

- previous `arr->size = 0`
- `count = 2,097,152`
- final `arr->size = 2,097,152`

Observed runtime state after decode:

```text
parsed_count=2097152 capacity=2097152
```

This is exactly what the reserve path predicts:

| Check | Expected | Observed | Result |
|-------|----------|----------|--------|
| `count` | `2,097,152` | `2,097,152` | OK |
| final parsed size | `2,097,152` | `2,097,152` | OK |
| final capacity | `2,097,152` | `2,097,152` | OK |
| decode status | `Ok` | `Ok` | OK |

## Conclusion

The exercised runtime state is internally consistent and does not show a reserve overflow on this build.

The most important checks all line up:

- packed byte length decodes to the expected element count
- reserve target is positive and in-range
- growth reaches an exact power-of-two capacity without overflow
- final parsed count and final capacity match the requested element count

## Final Status

`STATE_OK`
