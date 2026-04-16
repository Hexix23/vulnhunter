# Consensus Report: protobuf-input-002

## Summary

| Metric | Value |
|--------|-------|
| **Confidence Level** | CONFIRMED |
| **Total Score** | 2.0 / 4.0 |
| **Recommendation** | REPORT |

## Validator Results

### ASan Validator
- **Status:** NO_CRASH (-0.3)
- **Evidence:** The available ASan artifacts aborted before reaching the reported cast site, so no crash was observed on the exact `DoTestIo()` framing path.
- **Key Finding:** No memory-corruption confirmation; validator marked the result as needing further investigation rather than disproving the framing issue.

### LLDB Validator
- **Status:** STATE_BUG (+0.9)
- **Evidence:** Runtime capture showed `output_size=4294967300 (0x100000004)` and `network_out=4 (0x4)` while the payload write still used the full `4294967300` bytes.
- **Key Finding:** The emitted frame header truncates to 32 bits and no longer matches the payload length.

### Fresh Validator
- **Status:** FOUND (+1.0)
- **Evidence:** Independent review found the same `size_t output_size` to `uint32_t network_out` narrowing at `targets/protobuf/upb/conformance/conformance_upb.c:288`.
- **Key Finding:** A large enough response will wrap the advertised frame size and desynchronize the length-prefixed stream.

### Impact Validator
- **Status:** LIMITED_IMPACT (+0.4)
- **Evidence:** The impact demo showed corrupted follow-on framing, parent blocking on a poisoned next-frame length, and allocation pressure from trusting that corrupted length.
- **Key Finding:** Practical consequences are real inside the conformance harness, but reachability is local-only and requires a response larger than 4 GiB.

## Consensus Analysis

### Agreement Points
- LLDB, Fresh, and Impact all support the same root cause: `output_size` is narrowed to a 32-bit frame length while the full payload is still written.
- The independent validators agree the resulting failure mode is protocol desynchronization rather than a direct memory-corruption primitive.
- The impact evidence matches the expected downstream behavior in `ForkPipeRunner::RunTest()`, which trusts the advertised frame length for later reads and allocation.

### Disagreement Points
- ASan did not confirm the bug because the available instrumented artifacts failed before the target path was exercised.
- This disagreement does not negate the finding; it indicates the issue is not observable as an ASan-style crash in the tested setup.

### Confidence Factors
- [+] Blind LLDB validation captured the bad runtime state directly.
- [+] Fresh validation independently found the same narrowing bug without relying on the LLDB result.
- [+] Impact validation demonstrated concrete downstream effects consistent with the code path.
- [-] ASan could not reproduce the condition on the real path and provided no crash signal.
- [-] Triggering the original truncation requires an oversized response greater than 4 GiB.

## Recommendation

**REPORT** - The finding is sufficiently supported as a logic/protocol bug. Report it with the caveat that the validated impact is limited to the conformance harness and depends on generating an extremely large response.

## Category

**Type:** Logic Bug (Integer Truncation / Framing Mismatch)  
**Impact:** Stream Desynchronization, Blocking Reads, Allocation Pressure  
**Severity Estimate:** MEDIUM

## Evidence References

- `bugs/protobuf/protobuf-input-002/validation/asan_result.json`
- `bugs/protobuf/protobuf-input-002/validation/lldb_result.json`
- `bugs/protobuf/protobuf-input-002/validation/fresh_result.json`
- `bugs/protobuf/protobuf-input-002/validation/impact_result.json`
