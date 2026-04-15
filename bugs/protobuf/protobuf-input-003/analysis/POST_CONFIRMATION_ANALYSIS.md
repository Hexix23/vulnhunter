# Post-Confirmation Analysis: protobuf-input-003

## Executive Summary

The confirmed bug is an unchecked signed addition in `WireFormatLite::ReadPackedFixedSizePrimitive()` at `src/google/protobuf/wire_format_lite.h:1148` and `:1156`. It affects packed fixed-width repeated fields when binary protobuf data is merged into a destination message whose field is already near `INT_MAX` elements. The most credible consequence is denial of service through abort or undefined-behavior fallout in repeated-field growth logic.

This is not a generic fresh-parse bug. Public `ParseFrom*()` wrappers clear the destination first, which removes the large `old_entries` precondition. Reachability is strongest through merge-oriented APIs such as `MessageLite::MergeFromString()`, `MergeFromCodedStream()`, and the delimited parsing helpers that call `MergeFromCodedStream()` on caller-supplied message objects.

## Key Findings

### Entry Points

- Public merge APIs on `MessageLite` are the primary entry points:
  - `MergeFromString(absl::string_view)` and `MergePartialFromString(...)`
  - `MergeFromString(const absl::Cord&)` and `MergePartialFromString(...)`
  - `MergeFromCodedStream(io::CodedInputStream*)`
- `util::ParseDelimitedFromZeroCopyStream()` and `ParseDelimitedFromCodedStream()` are also relevant because they merge into an existing message rather than clearing first.
- Reflection-based parsing in `wire_format.cc` is out of scope for this finding because it does not use the vulnerable preallocation helper.

### Trigger Conditions

- Field type must be one of: `fixed32`, `fixed64`, `sfixed32`, `sfixed64`, `float`, or `double`.
- The destination repeated field must already contain nearly `INT_MAX` elements.
- The attacker-controlled packed field only needs to contribute enough elements to cross the signed `int` boundary.

### Consequences

- Observed impact is process termination from signed-overflow fallout and repeated-field size checks.
- In optimized builds, the same condition remains undefined behavior because the non-negative check in `ResizeImpl()` is only a `DCHECK`.
- The issue is best classified as denial of service with narrow but real stateful reachability.

### Related Issues

- `parse_context.h:1517-1549` contains a similar `old_entries + num` reserve pattern in the newer packed fixed-width parser, but with a more bounded incremental count.
- `repeated_field.h:1224-1231` contains similar unchecked `old_size + other_size` arithmetic in container merge code.
- These are worth follow-up review, but they are not as directly exposed as the confirmed sink.

## Risk Assessment

| Factor | Rating | Notes |
|--------|--------|-------|
| Reachability | MEDIUM | Public merge APIs are exposed, but the destination must already be extremely large. |
| Complexity | LOW | Once the precondition exists, the triggering input is straightforward. |
| Impact | MEDIUM | Reliable denial of service is supported; memory corruption is not confirmed. |
| Likelihood | LOW-MEDIUM | Requires a long-lived or reused message object with near-`INT_MAX` packed repeated state. |

## Mitigations Present Today

- `ReadVarintSizeAsInt()` bounds `length` to `int`.
- Packed length alignment is validated.
- Byte-limit checks avoid preallocating solely from huge untrusted lengths.
- `ParseFrom*()` clears the destination before parsing.

These protections are incomplete because none validate `old_entries + new_entries` before using it as a signed element count.

## Recommendations

1. Fix the sink by performing checked addition before `resize()` / `Reserve()`.
2. Return parse failure when `old_entries + new_entries > INT_MAX` rather than relying on downstream assertions.
3. Audit similar growth sites, especially `ParseContext::ReadPackedFixed()` and repeated-field merge helpers, for the same checked-add invariant.
4. Include the practical precondition in the vendor report so impact is described accurately: stateful merge into an already huge repeated field, not arbitrary fresh parsing of small messages.
