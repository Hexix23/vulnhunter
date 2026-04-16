# protobuf upb conformance runner: unchecked frame length and 32-bit output truncation

**Product:** Protocol Buffers (`protobuf`)
**Repository:** `https://github.com/protocolbuffers/protobuf`
**Component:** `targets/protobuf/upb/conformance/conformance_upb.c`
**Version:** `514aceb974fbd55031169b79d2bd9f7646157787`
**Function:** `DoTestIo()`
**Location:** `targets/protobuf/upb/conformance/conformance_upb.c:253-290`
**Type:** CWE-190 (Integer Overflow or Wraparound)
**CVSS 3.1:** 3.3 (`CVSS:3.1/AV:L/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L`)
**Validation Status:** Confirmed, limited to the test-only `conformance_upb` framing path

## Summary

`DoTestIo()` trusts the first 4 bytes received on stdin as a little-endian `uint32_t` frame length, allocates that many bytes with `upb_Arena_Malloc()`, and immediately passes the returned pointer to `CheckedRead()` without any maximum-size check or allocation-failure handling. The same function later narrows `size_t output_size` back to `uint32_t` before emitting the response frame header.

This produces two concrete issues in the conformance worker protocol:

1. A malformed frame length can force a multi-gigabyte allocation/read attempt before protobuf parsing begins.
2. If a serialized response ever exceeds `UINT32_MAX`, the worker advertises a truncated 32-bit frame length but still writes the full payload, desynchronizing the parent/child protocol stream.

This issue is in the conformance test binary, not the shipped public `libprotobuf.a`/`libupb.a` API surface in this workspace.

## Vulnerable Code

```c
bool DoTestIo(upb_DefPool* symtab) {
  uint32_t input_size;
  size_t output_size;
  ctx c;

  if (!CheckedRead(STDIN_FILENO, &input_size, sizeof(uint32_t))) {
    return false;
  }

  c.arena = upb_Arena_New();
  input = upb_Arena_Malloc(c.arena, input_size);  // attacker-controlled size

  if (!CheckedRead(STDIN_FILENO, input, input_size)) {  // no NULL/size guard
    fprintf(stderr, "conformance_upb: unexpected EOF on stdin.\n");
    exit(1);
  }

  output = conformance_ConformanceResponse_serialize(c.response, c.arena,
                                                     &output_size);
  uint32_t network_out = (uint32_t)output_size;  // lossy narrowing
  CheckedWrite(STDOUT_FILENO, &network_out, sizeof(uint32_t));
  CheckedWrite(STDOUT_FILENO, output, output_size);
}
```

## Impact

1. **Availability:** a caller controlling stdin framing can make the conformance worker request a huge arena allocation and then abort when the promised bytes are unavailable.
2. **Protocol integrity:** responses larger than 4 GiB are framed with a truncated 32-bit prefix, which can corrupt the conformance session.
3. **Attack vector:** local execution of the `conformance_upb` binary or automation that feeds framed requests into it.

## Reproduction

### Prerequisites

```bash
cd /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf
git checkout 514aceb974fbd55031169b79d2bd9f7646157787
cd /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter
```

### Build the validation harness

```bash
bash bugs/protobuf/protobuf-input-001/validation/build_impact.sh
```

### Trigger the oversized-input path

```bash
python3 - <<'PY' | bugs/protobuf/protobuf-input-001/validation/impact_demo
import struct, sys
sys.stdout.buffer.write(struct.pack("<I", 0x7ffff000))
PY
```

### Trigger the output-length truncation path

```bash
python3 - <<'PY' | bugs/protobuf/protobuf-input-001/validation/impact_demo --cast-only
import struct, sys
sys.stdout.buffer.write(struct.pack("<I", 1) + b'Z')
PY
```

## Proof of Concept

`bugs/protobuf/protobuf-input-001/validation/impact_demo.cpp` reproduces the same state transitions as `DoTestIo()`: attacker-controlled 32-bit size, `upb_Arena_Malloc()` with that size, `CheckedRead()` using the returned pointer, and a `size_t` to `uint32_t` response-frame cast.

## Evidence

### Runtime proof

```text
small_frame:
  exit=0
  stderr=impact_demo: requested=1 ptr=0x6130000005f0
  stdout=output_size=18446744073709551615 network_out=4294967295

oversized_frame:
  exit=1
  stderr=impact_demo: requested=2147479552 ptr=0x300004810
  stderr=impact_demo: unexpected EOF after oversized frame request (requested=2147479552)
```

### ASan output from the linked real-library probe

```text
requested=4294967295 ptr=0x300004810
allocator returned non-NULL
```

The supplied archive-level probe did not crash under ASan because the actual `conformance_upb` executable was not present in the provided build artifacts. The bug remains valid in source and in the dedicated conformance binary path.

## Why this is a bug

- `input_size` is fully attacker-controlled and is used before any sanity bound.
- `upb_Arena_Malloc()` is not checked for failure before `CheckedRead()` writes into the returned pointer.
- `output_size` is wider than the protocol field used to transmit it back out.

## Suggested Fix

```c
if (input_size > MAX_CONFORMANCE_FRAME) {
  fprintf(stderr, "conformance_upb: frame too large: %u\n", input_size);
  exit(1);
}

input = upb_Arena_Malloc(c.arena, input_size);
if (input == NULL && input_size != 0) {
  fprintf(stderr, "conformance_upb: allocation failed for %u bytes\n", input_size);
  exit(1);
}

if (output_size > UINT32_MAX) {
  fprintf(stderr, "conformance_upb: response too large: %zu\n", output_size);
  exit(1);
}

uint32_t network_out = (uint32_t)output_size;
```

## Notes

- Reachability is limited to the conformance/test executable path.
- The same file also contains an uninitialized `upb_Status status` read on the parse-failure path at line 281, but that is separate from the framing issue documented here.
