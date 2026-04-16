# Consensus Report: protobuf-input-003

## Summary

| Metric | Value |
|--------|-------|
| **Confidence Level** | CONFIRMED_HIGH |
| **Total Score** | 3.0 / 4.0 |
| **Recommendation** | REPORT |

## Validator Results

### ASan Validator
- **Status:** LOGIC_BUG (+0.7)
- **Evidence:** A real libprotobuf build hit UBSan signed integer overflow at `wire_format_lite.h:1148` on `2147483647 + 1`, then aborted on the repeated-field non-negative size assertion.
- **Key Finding:** The packed fixed-field growth path can compute an invalid signed size before container resizing.

### LLDB Validator
- **Status:** STATE_BUG (+0.9)
- **Evidence:** The debug PoC established `initial_size=2147483647`, reproduced the same signed overflow, and showed `new_size = -2147483648` reaching `RepeatedField::ResizeImpl()`.
- **Key Finding:** Corrupted container state is observable at runtime even without a full interactive LLDB session.

### Fresh Validator
- **Status:** FOUND (+1.0)
- **Evidence:** Independent review found the unchecked `old_entries + new_entries` addition on both the `resize()` and `Reserve()` paths in `ReadPackedFixedSizePrimitive()`.
- **Key Finding:** The same overflow condition was identified without relying on prior validator conclusions.

### Impact Validator
- **Status:** LIMITED_IMPACT (+0.4)
- **Evidence:** A public `MessageLite::MergeFromString()` demo reached process termination through the same parser path, but only when the destination repeated field was already near `INT_MAX` elements.
- **Key Finding:** Reachable through public merge APIs and network-fed data, with practical impact constrained to denial of service under extreme preconditions.

## Consensus Analysis

### Agreement Points
- All four validators support the same root cause: unchecked signed addition of `old_entries + new_entries`.
- Runtime execution confirmed the overflow manifests in the real container-growth path, not just in static reasoning.
- Independent fresh analysis matched the implementation bug identified by the dynamic validators.
- Impact analysis confirmed externally reachable denial of service through public merge APIs.

### Disagreement Points
- None on root cause or reportability.
- Impact is narrower than a memory-corruption issue because the demonstrated effect is process abort and the trigger requires a destination message already near the signed element ceiling.

### Confidence Factors
- [+] ASan/UBSan produced direct runtime evidence of signed overflow at the reported source line.
- [+] State-level evidence showed the negative post-overflow size propagating into `RepeatedField::ResizeImpl()`.
- [+] Fresh validation independently rediscovered the exact arithmetic flaw.
- [-] Practical exploitation requires an already enormous in-memory repeated field, limiting the issue to denial of service in edge-case aggregation flows.

## Recommendation

**REPORT** - The finding meets `CONFIRMED_HIGH` confidence. The validators consistently show a real signed-overflow bug in packed fixed-field preallocation, and impact is sufficiently demonstrated as externally reachable denial of service despite the high state-size prerequisite.

## Category

**Type:** Logic Bug (Signed Integer Overflow)  
**Impact:** Denial of Service via container-growth failure  
**Severity Estimate:** MEDIUM

## Evidence Files

- `bugs/protobuf/protobuf-input-003/validation/asan_result.json`
- `bugs/protobuf/protobuf-input-003/validation/lldb_result.json`
- `bugs/protobuf/protobuf-input-003/validation/fresh_result.json`
- `bugs/protobuf/protobuf-input-003/validation/impact_result.json`
