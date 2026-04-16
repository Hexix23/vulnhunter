# Consequence Analysis: protobuf-input-001

## Consequence Matrix

| Type | Severity | Likelihood | Trigger | Notes |
|------|----------|------------|---------|-------|
| Process termination | MEDIUM | HIGH | Large `input_size` causes `upb_Arena_Malloc()` to fail and `CheckedRead()` uses the null pointer | Deterministic once allocation fails |
| Resource exhaustion | MEDIUM | HIGH | Large but satisfiable `input_size` | Memory pressure comes before protobuf parsing |
| Protocol desynchronization | LOW to MEDIUM | LOW | `output_size > UINT32_MAX` and cast truncates the frame length prefix | Limited by needing a response larger than 4 GiB |
| Incorrect test results / CI disruption | MEDIUM | MEDIUM | Either failure mode above | Affects conformance runs, not production parsing APIs |

## Detailed Analysis

### 1. Unchecked input length drives allocation and null-target read

**Trigger**

- `DoTestIo()` reads a raw `uint32_t input_size` from stdin at `targets/protobuf/upb/conformance/conformance_upb.c:261`.
- That value is passed directly to `upb_Arena_Malloc(c.arena, input_size)` at line 268 with no bounds check and no null check.
- `upb/base/error_handler.h` explicitly states `upb_Arena_Malloc()` is only assumed non-null when an error handler is present. `DoTestIo()` does not install one.

**Observable behavior**

- If the allocation fails, `input` becomes `NULL`.
- `CheckedRead()` then calls `read(fd, (char*)buf + ofs, len)` with `buf == NULL`.
- On POSIX this yields `read(..., NULL, len)` and typically fails with `EFAULT`; `CheckedRead()` treats any negative return as fatal, prints `perror("reading from test runner")`, and `exit(1)`.

**Impact**

- Immediate termination of the conformance child process.
- The parent runner sees a runtime failure / child exit, interrupting the conformance session.
- This is a denial of service against the test executable, not memory corruption in a deployed server.

**Persistence**

- Temporary. Restarting the process clears the condition.
- In CI or automated testing, it can reliably fail the current job until the crafted input is removed.

### 2. Oversized but successful allocation can exhaust memory before parsing

**Trigger**

- The attacker supplies a very large but still allocatable `input_size`.
- `CheckedRead()` then attempts to read exactly that many bytes before any protobuf-level parsing happens.

**Observable behavior**

- Large resident memory growth in the arena allocation.
- Long blocking read on stdin while the caller streams the promised payload.
- Possible OOM kill, swap thrash, or severe slowdown depending on the environment.

**Impact**

- Resource exhaustion affects the conformance process and potentially the host running tests.
- The failure occurs before `conformance_ConformanceRequest_parse()` can reject malformed data, so protobuf semantic validation does not mitigate it.

**Persistence**

- Usually temporary, but host-level memory pressure can disturb other colocated jobs until reclaim completes.

### 3. Truncated 32-bit output length can desynchronize the framing protocol

**Trigger**

- `conformance_ConformanceResponse_serialize()` returns an `output_size` stored as `size_t`.
- `DoTestIo()` narrows it with `uint32_t network_out = (uint32_t)output_size` at line 288 and then writes the full `output_size` bytes at line 290.
- If `output_size > 0xffffffff`, the advertised frame length wraps modulo `2^32`.

**Observable behavior**

- The peer reads the 32-bit prefix as a much smaller `M`.
- It consumes only `M` bytes as the response frame and leaves the remaining bytes in the pipe.
- Subsequent reads interpret leftover response data as the next frame header, corrupting message boundaries for all later tests.

**Impact**

- Protocol-level corruption and cascading parse failures in the conformance session.
- No direct out-of-bounds write is implied by this cast alone; the primary damage is incorrect framing and test infrastructure breakage.

**Persistence**

- Persists for the life of the pipe/session after the first oversized response.
- Resetting the child process and pipe state recovers.

### 4. Incorrect reporting amplifies the operational impact

**Trigger**

- On the allocation-failure path, the process exits before constructing a valid `ConformanceResponse`.
- On the truncation path, the process may emit a syntactically malformed framed stream.

**Observable behavior**

- The test runner reports runtime errors, unexpected EOF, or parse mismatches unrelated to the actual test case semantics.

**Impact**

- Debugging time increases because the failure surfaces as runner instability rather than a clean protobuf parse error.
- This can mask genuine conformance regressions until the harness issue is fixed.

## Existing Mitigations

- The executable is `testonly`, which limits exposure to test and development workflows.
- The input source is local stdin/stdout rather than a built-in network listener.
- EOF handling at the first `CheckedRead()` cleanly terminates the normal loop, but this does not protect against oversized lengths.
- No size cap, allocation-failure check, or response-size guard is present before the vulnerable operations.

## Overall Impact Assessment

- **Reachability:** High within the intended harness model, because the first four bytes on stdin directly control `input_size`.
- **Exploit complexity:** Low for the allocation failure / resource exhaustion branch.
- **Impact scope:** Medium overall because the target is a test executable, not the production protobuf library.
- **Most realistic consequence:** Conformance-process crash or memory exhaustion.
- **Less realistic but real consequence:** Framing desynchronization if a response exceeds 4 GiB.
