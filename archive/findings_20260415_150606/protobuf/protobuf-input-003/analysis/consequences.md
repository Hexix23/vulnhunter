# Consequence Analysis: protobuf-input-003

## Consequence Matrix

| Type | Severity | Likelihood | Conditions |
|------|----------|------------|------------|
| Process termination | MEDIUM | MEDIUM | Destination field already near `INT_MAX`; signed overflow reaches resize/growth path and triggers checks or UB fallout. |
| Failed merge / partial processing | LOW | MEDIUM | Overflowed size propagates into repeated-field operations and parse fails before completing the message. |
| Undefined behavior in optimized builds | MEDIUM | LOW | Build omits `DCHECK`s and compiler/runtime behavior after signed overflow is not fully deterministic. |
| Memory exhaustion | LOW | LOW | Less likely than termination here because the overflow tends to corrupt the requested count before a huge valid allocation request is formed. |

## Trigger Condition

The attacker controls `length`, but `length` alone is insufficient. The overflow requires:

- A packed fixed-width repeated field.
- An existing destination size `old_entries` close to `INT_MAX`.
- At least one new decoded element (`new_entries > 0`).

Because `ReadVarintSizeAsInt()` constrains `length` to `int`, a freshly cleared message cannot overflow `old_entries + new_entries`; the dangerous state comes from merging into a message that already holds an extremely large repeated field.

## Detailed Consequences

### 1. Process termination

**Trigger:** `old_entries + new_entries` crosses `INT_MAX` in the fast preallocation path.

**Behavior:** The confirmed evidence shows:

- UBSan reports signed integer overflow at `wire_format_lite.h:1148`.
- The corrupted negative size reaches repeated-field resize logic.
- Protobuf aborts on the repeated-field non-negative size check in the reproduced test scenario.

**Affected scope:** The current process. This is a denial-of-service condition, not a cross-process escape.

**Persistence:** Temporary. Restarting the process restores service, assuming the triggering message/object state is not replayed immediately.

### 2. Failed merge and inconsistent message update

**Trigger:** The corrupted element count reaches `resize()` or `Reserve()` and causes the parse to fail or abort before the incoming message is fully merged.

**Behavior:** The destination message may remain in one of two states:

- Unmodified past the last successfully merged field.
- Partially updated for earlier fields, with the current packed field failing mid-parse.

The library tries to truncate back to `old_entries` after a failed `ReadRaw()` on the little-endian fast path, but the overflow occurs before that recovery point. That makes the failure mode "abort or undefined behavior during sizing", not a clean parse rejection.

**Affected scope:** The in-memory message object being merged and any request / stream handler that depends on it.

**Persistence:** Temporary unless the application persists the partially updated object before failure.

### 3. Undefined behavior surface in optimized builds

**Trigger:** Same arithmetic overflow, in builds where debug assertions are not active.

**Behavior:** Signed integer overflow in C++ is undefined behavior. Practically, likely outcomes are:

- Negative or wrapped size passed to `ResizeImpl()` or `Reserve()`.
- Abort from downstream runtime assertions in some configurations.
- Memory-corruption-adjacent logic errors if compiler optimizations exploit the UB unexpectedly.

**Assessment:** The current evidence supports denial of service, not confirmed memory corruption. The report should stay conservative and describe this as UB with observed termination, not as a proven exploit for arbitrary memory access.

### 4. Resource impact

**Trigger:** An application keeps a repeated field near `INT_MAX` elements and continues merging more packed values.

**Behavior:** Even before the overflow boundary is crossed, maintaining such a message implies extreme memory pressure. The bug converts that already stressed state into an abrupt failure rather than a clean bounded rejection.

**Affected scope:** Heap usage and process availability.

**Persistence:** Temporary, but repeated triggering can create a stable crash loop for stateful services.

## What Does Not Happen

- There is no evidence in this repository that a fresh `ParseFrom*()` on an empty message can hit this bug.
- There is no evidence here of out-of-bounds reads from attacker-controlled packed length alone.
- There is no confirmed memory corruption primitive beyond the signed-overflow UB and subsequent termination path.

## Existing Mitigations and Their Limits

| Mitigation | Location | Effect | Limitation |
|------------|----------|--------|------------|
| `ReadVarintSizeAsInt()` bounds packed length to `int` | `src/google/protobuf/wire_format_lite.h:1120` | Prevents oversized `length` values above `INT_MAX` | Does not protect `old_entries + new_entries` |
| Packed-size alignment check `new_bytes != length` | `src/google/protobuf/wire_format_lite.h:1122-1124` | Rejects malformed non-multiple lengths | Does not bound total post-merge element count |
| Byte-limit check before preallocation | `src/google/protobuf/wire_format_lite.h:1137-1145` | Prevents allocating solely based on an untrusted huge length | Uses `new_bytes`, not final element count |
| Non-negative size `DCHECK` in `ResizeImpl()` | `src/google/protobuf/repeated_field.h:932` | Catches bad sizes in debug-style builds | Not a reliable production safeguard |
| `ParseFrom*()` clears destination | `src/google/protobuf/message_lite.cc:351-423` | Removes the large `old_entries` precondition | Does not help merge-style APIs or delimited helpers |

## Impact Summary

The most defensible impact statement is:

> A stateful application that merges attacker-controlled binary protobuf data into a message whose packed fixed-width repeated field is already near `INT_MAX` elements can be driven into process termination. The bug is primarily a denial-of-service issue with a narrow but real precondition, not a proven memory-corruption exploit.
