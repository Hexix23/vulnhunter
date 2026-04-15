# Consensus Report: protobuf-input-001

## Summary

| Metric | Value |
|--------|-------|
| **Confidence Level** | CONFIRMED |
| **Total Score** | 2.0 / 4.0 |
| **Recommendation** | REPORT |

## Validator Results

### ASan Validator
- **Status:** NO_CRASH (-0.3)
- **Evidence:** ASan harness exited cleanly and did not reproduce memory corruption in the supplied shipped artifacts.
- **Key Finding:** The reported sink could not be confirmed as a memory-safety failure in the provided build outputs.

### LLDB Validator
- **Status:** STATE_BUG (+0.9)
- **Evidence:** Runtime tracing captured `input_size=2147479552` being used unchecked and `output_size=18446744073709551615` narrowing to `network_out=4294967295`.
- **Key Finding:** DoTestIo() trusts attacker-controlled frame sizes and performs a lossy 32-bit output framing cast.

### Fresh Validator
- **Status:** FOUND (+1.0)
- **Evidence:** Independent review found the `size_t` to `uint32_t` truncation risk in the response length prefix and also noted a separate uninitialized-status bug.
- **Key Finding:** The output framing bug was rediscovered without relying on prior validator context.

### Impact Validator
- **Status:** LIMITED_IMPACT (+0.4)
- **Evidence:** Rebuilt demos showed oversized frame requests can disrupt conformance runs and that oversized outputs would desynchronize framing, but only in the test-only conformance binary.
- **Key Finding:** The issue is practically reachable through framed stdin/stdout workflows, with local operational impact rather than production-library compromise.

## Consensus Analysis

### Agreement Points
- LLDB, Fresh, and Impact all support a logic flaw in `DoTestIo()` around framed length handling.
- Two validators independently confirmed the lossy output-length narrowing from `size_t` to `uint32_t`.
- Runtime evidence shows the code uses attacker-controlled frame lengths before validating request contents.

### Disagreement Points
- ASan did not confirm memory corruption or a sanitizer-detectable crash in the supplied artifacts.
- Impact validation limits the consequence to the test-only `conformance_upb` executable rather than shipped library APIs.

### Confidence Factors
- [+] Independent fresh review corroborated a core framing issue.
- [+] LLDB/runtime tracing showed the faulty state transitions directly.
- [+] Impact work demonstrated reachable local disruption scenarios.
- [-] No memory-safety crash was reproduced.
- [-] Demonstrated impact is constrained to conformance tooling.

## Recommendation

**REPORT** - The combined evidence supports a real, reportable logic bug in framed length handling, with moderate confidence due to the negative ASan result and limited deployment impact.

## Category

**Type:** Logic Bug (Length Validation / Integer Truncation)  
**Impact:** Local Resource Exhaustion and Framing Desynchronization  
**Severity Estimate:** MEDIUM

## Evidence Files

- `validation/asan_result.json`
- `validation/lldb_result.json`
- `validation/fresh_result.json`
- `validation/impact_result.json`
