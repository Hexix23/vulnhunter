# Related Issues Analysis: protobuf-input-002

## Search Summary

I searched for:
- direct uses of `upb_String_Append()` and `upb_String_Reserve()`
- `upb_Arena_Realloc()` call sites with growth arithmetic
- doubling patterns such as `* 2`, `+ 1`, and reserve-style helpers

## Similar Patterns Found

### Pattern 1: Unchecked growth arithmetic before realloc

| File | Line | Function | Status | Notes |
|------|------|----------|--------|-------|
| `targets/protobuf/upb/io/string.h` | 87 | `upb_String_Append` | CONFIRMED | This finding |
| `targets/protobuf/upb/io/string.h` | 76 | `upb_String_Reserve` | RELATED | `size + 1` can also wrap if passed a near-`SIZE_MAX` value |
| `targets/protobuf/upb/json/decode.c` | 428 | `jsondec_resize` | POTENTIALLY SIMILAR | `size = UPB_MAX(8, 2 * oldsize)` has no visible overflow check before realloc |
| `targets/protobuf/upb/message/internal/compare_unknown.c` | 71 | `upb_UnknownFields_Grow` | POTENTIALLY SIMILAR | `old * 2` and `new * sizeof(**base)` are unchecked |
| `targets/protobuf/upb/reflection/desc_state.c` | 23 | `_upb_DescState_Grow` | POTENTIALLY SIMILAR | `d->bufsize *= 2` is unchecked, though state may be more internally bounded |

### Pattern 2: Growth code that already has overflow defenses

| File | Line | Function | Status | Why it looks safer |
|------|------|----------|--------|--------------------|
| `targets/protobuf/upb/message/array.c` | 166 | `_upb_Array_Realloc` | REVIEWED_NOT_SIMILAR | Uses `upb_ShlOverflow()` before resizing bytes |

## Notes on Key Candidates

### 1. `jsondec_resize()` at `upb/json/decode.c:425`

```text
jsondec_string()
  -> jsondec_resize()
  -> size = UPB_MAX(8, 2 * oldsize)
  -> upb_Arena_Realloc(...)
```

Why it matters:
- It processes attacker-controlled JSON strings.
- The buffer is repeatedly expanded as parsing continues.
- The doubling arithmetic is not guarded the way `_upb_Array_Realloc()` is.

Why it is not promoted to confirmed here:
- I did not build a reproducer in this pass.
- The exact `upb_Arena_Realloc()` semantics and surrounding length invariants were not exhaustively validated for this path.

### 2. `upb_UnknownFields_Grow()` at `upb/message/internal/compare_unknown.c:67`

Why it matters:
- Uses unchecked `old * 2` and `new * sizeof(**base)` before reallocation.

Why confidence is lower:
- The input and state are more indirect.
- This helper is part of unknown-field comparison logic, not an obvious front-door parser API.

### 3. `_upb_DescState_Grow()` at `upb/reflection/desc_state.c:12`

Why it matters:
- Performs unchecked `d->bufsize *= 2`.

Why confidence is lower:
- It appears to support internal descriptor-state growth, where sizes may be constrained by format and encoder design.

## Recommended Additional Review

1. Reproduce `jsondec_resize()` with a large JSON string and sanitizer instrumentation.
2. Audit all `upb_Arena_Realloc()` callers that derive sizes using `* 2`, `+ 1`, or `count * sizeof(T)` without helper overflow checks.
3. Consider introducing a shared checked-growth helper for `upb` string/buffer expansion so the same bug class is not fixed piecemeal.
