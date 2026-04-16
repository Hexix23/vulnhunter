# Consensus Report: protobuf-input-004

## Summary

| Metric | Value |
|--------|-------|
| **Confidence Level** | CONFIRMED |
| **Total Score** | 2.7 / 4.0 |
| **Recommendation** | REPORT |

## Validator Results

### ASan Validator
- **Status:** CONFIRMED_MEMORY (+1.0)
- **Evidence:** Signed truncation in `_upb_DescState_Grow()` skipped a required realloc, and a later encoder write produced an ASan fatal write.
- **Key Finding:** A logical pointer delta of `2147483679` became `-2147483617`, turning the space check into a false pass.

### LLDB Validator
- **Status:** STATE_BUG (+0.9)
- **Evidence:** Instrumented runtime captured `logical_used_64=2147483679`, `truncated_used_32=-2147483617`, `expected_realloc=true`, and `skipped_realloc=true`.
- **Key Finding:** The blind state proof independently shows the realloc gate was bypassed while `bufsize_after` remained `64`.

### Fresh Validator
- **Status:** FOUND (+1.0)
- **Evidence:** Independent review found the same `d->ptr - d->buf` narrowing to `int` and noted both the free-space check and pointer restoration can be corrupted.
- **Key Finding:** The same integer-handling bug was identified without relying on prior validator conclusions.

### Impact Validator
- **Status:** NO_PRACTICAL_IMPACT (-0.2)
- **Evidence:** Public API testing found earlier message-size limits and infeasible enum-scale requirements before the scratch buffer could exceed `INT_MAX`.
- **Key Finding:** The bug is real, but practical exploitation through shipped entry points appears heavily constrained.

## Consensus Analysis

### Agreement Points
- ASan and LLDB agree on the core blind-validation question: the truncation bug manifests at runtime and can skip a required realloc.
- Fresh validation independently matches the same root cause in `targets/protobuf/upb/reflection/desc_state.c:15`.
- Three validators support a concrete defect, with two providing runtime evidence and one providing independent source-level confirmation.

### Disagreement Points
- The Impact validator disagrees on reportability severity, not on bug existence.
- Core validators show a real bug and crash path in synthetic state, while Impact concludes shipped public APIs hit earlier limits or unrealistic scale requirements first.

### Confidence Factors
- [+] Both blind core validators support the finding.
- [+] ASan produced a concrete crash after the skipped realloc.
- [+] Fresh validation independently found the same narrowing defect.
- [-] Practical-impact analysis reduces confidence in exploitability through public entry points.

## Recommendation

**REPORT** - The underlying defect is well supported by independent validators and meets the `CONFIRMED` threshold. Report it with clear caveats that current evidence supports a real bug and crash primitive in synthetic state, while practical impact through public APIs appears limited.

## Category

**Type:** Memory Corruption via Integer Truncation  
**Impact:** Scratch-buffer reallocation bypass leading to out-of-bounds write in follow-on encoder writes  
**Severity Estimate:** HIGH with reachability caveats

## Evidence Files

- `bugs/protobuf/protobuf-input-004/validation/asan_result.json`
- `bugs/protobuf/protobuf-input-004/validation/lldb_result.json`
- `bugs/protobuf/protobuf-input-004/validation/fresh_result.json`
- `bugs/protobuf/protobuf-input-004/validation/impact_result.json`
