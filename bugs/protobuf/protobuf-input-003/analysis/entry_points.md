# Entry Point Analysis: protobuf-input-003

## External Input Sources

| Source | Transport / Format | Public API | Notes |
|--------|---------------------|------------|-------|
| In-memory binary buffer | protobuf wire format | `MessageLite::MergeFromString()`, `MergePartialFromString()`, `MergeFromString(const Cord&)`, `MergePartialFromString(const Cord&)` | Directly feeds attacker-controlled packed-field bytes into the message parser without clearing the destination first. |
| Raw byte array | protobuf wire format | `MessageLite::MergeFromCodedStream()` via caller-managed `CodedInputStream` | Reachable when applications merge new wire data into an existing message object. |
| Zero-copy stream / file / socket wrapper | protobuf wire format | `util::ParseDelimitedFromZeroCopyStream()`, `util::ParseDelimitedFromCodedStream()` | Delimited helpers call `MergeFromCodedStream()` rather than `ParseFrom*()`, so preexisting repeated-field state is preserved. |
| File descriptor / `istream` / bounded stream | protobuf wire format | Indirect through merge-oriented callers using `CodedInputStream` or bounded streams | Not all wrappers are vulnerable by themselves; the key condition is merging into an already huge destination field. |

## Vulnerable Sink

The confirmed sink is `WireFormatLite::ReadPackedFixedSizePrimitive()` in `src/google/protobuf/wire_format_lite.h:1117-1168`. It:

1. Reads a length with `ReadVarintSizeAsInt()`.
2. Derives `new_entries = length / sizeof(CType)`.
3. Uses `old_entries + new_entries` in the fast path:
   - `values->resize(old_entries + new_entries, 0)` at line 1148.
   - `values->Reserve(old_entries + new_entries)` at line 1156.

`RepeatedField::ResizeImpl()` only guards non-negative size with `ABSL_DCHECK_GE(new_size, 0)` at `src/google/protobuf/repeated_field.h:932-944`, so optimized builds do not get a hard runtime validation before the corrupted signed value reaches container growth logic.

## Reachable Field Types

The vulnerable helper is only selected for packed fixed-width repeated primitives via the specializations at `src/google/protobuf/wire_format_lite.h:1176-1194`:

- `fixed32`
- `fixed64`
- `sfixed32`
- `sfixed64`
- `float`
- `double`

Reflection-based parsing in `src/google/protobuf/wire_format.cc:372-455` is a different path and iterates packed values one-by-one; it does not call the vulnerable preallocation helper.

## Call Chains

### Chain 1: Binary merge from string / Cord

```text
External binary protobuf bytes
  -> MessageLite::MergeFromString(data)
  -> MessageLite::ParseFrom<kMerge>(...)
  -> MergeFromImpl(...)
  -> internal::TcParser::ParseLoop(...)
  -> generated packed fixed-field parser
  -> WireFormatLite::ReadPackedPrimitive<fixed-width type>(...)
  -> WireFormatLite::ReadPackedFixedSizePrimitive(...)
  -> values->resize(old_entries + new_entries, 0) / Reserve(old_entries + new_entries)
```

Evidence:

- `MessageLite::MergeFromString()` routes to `ParseFrom<kMerge>` in `src/google/protobuf/message_lite.cc:426-466`.
- `MergeFromImpl()` builds a `ParseContext` and enters `TcParser::ParseLoop()` in `src/google/protobuf/message_lite.cc:221-257` and `318-330`.
- Packed fixed-width specializations dispatch to `ReadPackedFixedSizePrimitive()` in `src/google/protobuf/wire_format_lite.h:1176-1194`.

### Chain 2: Delimited stream merge

```text
External length-delimited protobuf stream
  -> util::ParseDelimitedFromZeroCopyStream(...)
  -> util::ParseDelimitedFromCodedStream(...)
  -> input->PushLimit(size)
  -> message->MergeFromCodedStream(input)
  -> MessageLite::MergeFromImpl(...)
  -> parser dispatch for packed fixed-width field
  -> WireFormatLite::ReadPackedFixedSizePrimitive(...)
```

Evidence:

- `ParseDelimitedFromZeroCopyStream()` and `ParseDelimitedFromCodedStream()` are public helpers in `src/google/protobuf/util/delimited_message_util.h:61-64`.
- The implementation calls `message->MergeFromCodedStream(input)` in `src/google/protobuf/util/delimited_message_util.cc:42-64`.

### Chain 3: Caller-managed `CodedInputStream`

```text
External bytes from file / IPC / socket / custom stream
  -> caller builds io::CodedInputStream
  -> MessageLite::MergeFromCodedStream(input)
  -> MessageLite::MergeFromImpl(...)
  -> internal::TcParser::ParseLoop(...)
  -> generated packed fixed-width field parser
  -> WireFormatLite::ReadPackedFixedSizePrimitive(...)
```

This is the most generic public entry point because many higher-level integrations eventually reduce to `MergeFromCodedStream()`.

## Reachability Assessment

- **Binary network/file reachable:** Yes, but only through APIs that merge into an existing message object.
- **Direct `ParseFrom*` exposure:** Limited. `ParseFromCodedStream()` and the other `ParseFrom*` wrappers clear the destination first in `src/google/protobuf/message_lite.cc:351-423`, which removes the large `old_entries` precondition.
- **State precondition:** The destination repeated field for a packed fixed-width type must already be close to `INT_MAX` elements before the attacker-controlled packed field is merged.
- **Authentication requirement:** None at the library layer.
- **Input validation before sink:** The helper validates packed-field alignment (`new_bytes == length`) and bounds against bytes limits, but it does not validate `old_entries + new_entries` for signed overflow.

## Practical Reachability Summary

The bug is not a generic "parse any protobuf and crash" condition. It is reachable when:

1. Application code retains a message object with a repeated packed fixed-width field already near `INT_MAX` elements.
2. New untrusted wire data is merged into that object through a merge-style binary API.
3. The incoming packed field adds at least one more element, causing `old_entries + new_entries` to overflow signed `int`.

That makes the issue realistic for long-lived accumulators, append-style state machines, incremental stream decoders, and any code using delimited merge helpers on reused objects.
