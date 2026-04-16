# Debug Report: protobuf-input-002

## Build Information

- Build directory: `builds/protobuf-asan-arm64`
- PoC source: `bugs/protobuf/protobuf-input-002/poc/poc_real.cpp`
- Debug binary: `bugs/protobuf/protobuf-input-002/debugging/poc_debug`
- Method used: `printf` fallback after LLDB launch failure

## Executive Summary

The framing bug is reproducible as a state bug. `DoTestIo()` stores `output_size` in a
`size_t`, truncates it to `uint32_t network_out`, then still writes `output_size` bytes.
With `output_size = 0x100000004`, the emitted frame header advertises `4` bytes while the
payload write still attempts `4294967300` bytes. That proves the stream becomes
desynchronized once the serialized response exceeds 4 GiB.

## LLDB Attempt

Native LLDB was attempted first because the Rosetta check did not return `1`.

```text
(lldb) run
error: process exited with status -1 (no such process)
```

Because the debugger could not launch the target, the evidence path fell back to the
instrumented PoC, which captures the exact values at the truncation site.

## Step-by-Step Evidence

### 1. Trigger Value Entering The Framing Logic

From `poc_real.cpp`, the harness calls `DoTestIoHarness()` with:

```c++
constexpr uint64_t kTrigger =
    static_cast<uint64_t>(std::numeric_limits<uint32_t>::max()) + 5ULL;
```

That evaluates to `4294967300` (`0x100000004`), which is 4 GiB plus 4 bytes.

### 2. Truncated Header Value

The vulnerable statement is modeled exactly:

```c++
uint32_t network_out = static_cast<uint32_t>(output_size);
CheckedWrite(STDOUT_FILENO, &network_out, sizeof(uint32_t));
CheckedWrite(STDOUT_FILENO, output, output_size);
```

Captured runtime state:

```text
STATE output_size=4294967300 (0x100000004)
STATE network_out=4 (0x4)
STATE network_order=0x4000000
```

Interpretation:

- Expected frame length if no truncation occurred: `4294967300`
- Actual advertised frame length after cast: `4`
- Truncation amount: exactly `4294967296` bytes (`2^32`)

### 3. Header And Payload Writes Diverge

Captured runtime state:

```text
STATE header_write_len=4
STATE payload_write_len=4294967300
STATE truncation_delta=4294967296
STATE frame_matches_payload=false
```

Interpretation:

- The first write emits a 4-byte length prefix, which is structurally correct.
- The second write still uses the original `size_t output_size`.
- The framing metadata and payload length no longer describe the same record.

## Conclusion

This is a confirmed `STATE_BUG`. The code emits a wrapped 32-bit frame length while still
writing the full 64-bit payload size. A reader that trusts the 32-bit prefix will consume
only 4 bytes and then interpret the remaining `4294967296` bytes as subsequent frames or
unstructured stream data.

## Summary Table

| Check | Expected | Actual | Result |
|---|---:|---:|---|
| `output_size` | `> UINT32_MAX` trigger | `4294967300` | OK |
| `network_out` | `4294967300` | `4` | BUG |
| Header write length | `4` | `4` | OK |
| Payload write length | `4` if framed correctly | `4294967300` | BUG |
| Frame matches payload | `true` | `false` | BUG |
