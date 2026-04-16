# Consequence Analysis: protobuf-input-002

## Consequence Matrix

| Type | Severity | Likelihood | Conditions |
|------|----------|------------|------------|
| Stream desynchronization | MEDIUM | HIGH once `output_size > UINT32_MAX` | Response body exceeds 4 GiB |
| Parent memory / CPU pressure | MEDIUM | MEDIUM | Parent interprets leftover body bytes as subsequent frames |
| Incorrect test results | LOW | HIGH once desynchronized | Any later test cases in the same child session |
| Child-side crash / write failure | LOW | MEDIUM | Pipe backpressure, closed reader, or OOM while creating the huge response |

## Detailed Analysis

### 1. Stream desynchronization

**Trigger condition**
- `conformance_ConformanceResponse_serialize()` returns `output_size > 0xffffffff`.
- `DoTestIo()` truncates that `size_t` to `uint32_t` at `conformance_upb.c:288`.

**Observable behavior**
- The child advertises only the low 32 bits of the response length.
- The child then writes the full `output_size` bytes at `conformance_upb.c:290`.
- The parent reads only the truncated length at `fork_pipe_runner.cc:115-117`, leaving the remainder of the oversized response queued on the pipe.

**Impact**
- The next 4 bytes of leftover response data are interpreted as the next frame length.
- The request/response stream loses synchronization for the remainder of that child process lifetime.
- Test outcomes after the first oversized reply become untrustworthy even when the later requests are benign.

**Persistence**
- Temporary for the overall harness run if the child is restarted.
- Persistent for the current child process session because the pipe state is corrupted until EOF or process replacement.

### 2. Parent memory and resource consumption

**Trigger condition**
- After desynchronization, the parent treats arbitrary leftover response bytes as a new 32-bit little-endian frame length.

**Observable behavior**
- `ForkPipeRunner::RunTest()` converts the next 4 bytes to `len`, then executes `response.resize(len)` before reading that many bytes.
- Because the length comes from response body data, it may be much larger than intended.

**Impact**
- The parent can allocate a very large `std::string` based on attacker-influenced bytes from the oversized response body.
- If enough bytes are unavailable, `CheckedRead()` can block until timeout or fail with EOF/runtime error.
- Resource impact is in the parent conformance runner, not memory corruption in the child.

**Persistence**
- Temporary, but it can stall or terminate the current test run and consume substantial memory while doing so.

### 3. Incorrect parsing and false runtime failures

**Trigger condition**
- The parent reads a truncated response successfully, then tries to parse it as a complete `ConformanceResponse`.
- Or the parent reads a later misframed chunk and parses garbage.

**Observable behavior**
- `ConformanceTestSuite::RunTest()` and `Testee::Run()` convert unparsable responses into `runtime_error("response proto could not be parsed.")`.
- The harness may report the child as failed or timed out even though the root cause is framing corruption, not parser logic for the tested message type.

**Impact**
- False negatives in conformance testing.
- Difficult triage because later failures are secondary symptoms of an earlier oversized response.

**Persistence**
- Affects all subsequent tests sharing that child process until restart.

### 4. Child process instability on extreme responses

**Trigger condition**
- Creating a response over 4 GiB already implies a very large allocation and write.

**Observable behavior**
- The child may exhaust arena memory before reaching the framing sink.
- Even if serialization succeeds, the full `CheckedWrite()` of `output_size` bytes can block on pipe capacity or fail if the parent aborts after parsing the truncated header.

**Impact**
- Process termination, timeout, or partial writes reported as runtime errors.
- This is secondary to the core framing bug, but it increases practical exploit consequences inside the harness.

**Persistence**
- Limited to the current test execution.

## Mitigations Present Today

- Input side is length-prefixed to 32 bits, which bounds request size but does not bound response size.
- Parent read path has a 30-second timeout in `ForkPipeRunner::TryRead()`, which limits indefinite blocking but does not prevent large allocations or protocol desynchronization.
- There is no guard that rejects responses larger than `UINT32_MAX` before header emission.
- There is no resynchronization logic in the parent once a child emits an inconsistent frame.

## Overall Impact Assessment

- Exploitability: Moderate in practice because generating a response above 4 GiB is expensive and limited to the conformance harness.
- Reliability: High once the size threshold is crossed; the framing mismatch is deterministic.
- Security class: Logic / protocol integrity bug with secondary resource-consumption effects, not direct memory corruption.

## Execution Report

**Environment:**
- OS: Darwin
- Arch: arm64
- Rosetta: NO

**Attempts:**
1. Inspected the vulnerable sink and consensus evidence -> confirmed `output_size` is `size_t` while frame header is `uint32_t`.
2. Traced parent read logic in `fork_pipe_runner.cc` -> confirmed truncated header controls `response.resize(len)`.
3. Traced suite-level handling in `conformance_test.cc` and `testee.cc` -> confirmed misframed replies degrade into parse/runtime errors.

**What Worked:**
- Source-level tracing across `conformance_upb.c`, `fork_pipe_runner.cc`, `conformance_test.cc`, and `testee.cc`.

**What Failed:**
- No runtime reproduction was attempted here because the finding was already confirmed and the task was post-confirmation scope analysis.

**Final Status:** SUCCESS
