# VALIDATION_EXECUTION_REPORT

Date: 2026-04-15

## Vulnerability Summary

- Component: Protobuf TextFormat unknown-field printer
- Location: `src/google/protobuf/text_format.cc`
- Issue: Recursion limit enforcement for `TYPE_GROUP` unknown fields can be bypassed, allowing recursion state to continue after the budget is exhausted.
- Impact: Nested group structures can be printed beyond the configured recursion limit, confirming a logic bug that can lead to stack exhaustion in deeper cases.

## Test Environment

- Library path: `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/builds/protobuf-asan-arm64/lib/libprotobuf.a`
- Architecture: arm64
- Validation method: Compile `bugs/protobuf/textformat-stackoverflow/debugging/poc_state.cpp` against the pre-built ASan protobuf library, then compare a control run at depth 10 with an exploit run at depth 12.
- Reason for printf fallback: LLDB could not reliably launch the inferior on this macOS host, so the fallback PoC records externally visible runtime state with printf-style output to prove the recursion-budget bypass.

## Control Run

```text
configured_unknown_field_recursion_limit=10
constructed_group_depth=10
expected_budget_after_last_group=0
print_ok=1
output_size=66
output_open_braces=10
output_close_braces=10
output_group_occurrences=10
terminal_value_present=1
output=1 { 1 { 1 { 1 { 1 { 1 { 1 { 1 { 1 { 1 { 2: 66 } } } } } } } } } } 
state_bug=0
```

## Exploit Run

```text
configured_unknown_field_recursion_limit=10
constructed_group_depth=12
expected_budget_after_last_group=-2
print_ok=1
output_size=78
output_open_braces=12
output_close_braces=12
output_group_occurrences=12
terminal_value_present=1
output=1 { 1 { 1 { 1 { 1 { 1 { 1 { 1 { 1 { 1 { 1 { 1 { 2: 66 } } } } } } } } } } } } 
state_bug=1
```

## Evidence

| Metric | Control (Depth 10) | Exploit (Depth 12) | Interpretation |
| --- | --- | --- | --- |
| Recursion Limit | 10 | 10 | (unchanged) |
| Constructed Depth | 10 | 12 | +2 over limit |
| Expected Budget After | 0 | -2 | Negative budget |
| Groups Printed | 10 | 12 | Limit bypassed |
| Terminal Value | Present | Present | Fully parsed |
| State Bug Detected | NO | YES | Bug confirmed |

## Conclusion

CONFIRMED - Logic Bug in Recursion Limit Enforcement

## References

- `LLDB_DEBUG_REPORT.md`
- `poc/asan_output.txt`
- `analysis/POST_CONFIRMATION_ANALYSIS.md`
