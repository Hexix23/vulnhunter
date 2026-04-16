# upb String helper: integer wrap in `upb_String_Append()` can underflow the write pointer

**Product:** Protocol Buffers (`protobuf`)
**Repository:** `https://github.com/protocolbuffers/protobuf`
**Component:** `targets/protobuf/upb/io/string.h`
**Version:** `514aceb974fbd55031169b79d2bd9f7646157787`
**Function:** `upb_String_Append()`
**Location:** `targets/protobuf/upb/io/string.h:85-95`
**Type:** CWE-190 (Integer Overflow or Wraparound)
**CVSS 3.1:** 3.3 (`CVSS:3.1/AV:L/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L`)
**Validation Status:** Confirmed as a real helper bug; not reachable through the shipped `libupb.a` archive in this workspace because tokenizer objects were absent

## Summary

`upb_String_Append()` performs unchecked `size_t` arithmetic in both the capacity check and the growth calculation:

- `s->size_ + size`
- `2 * (s->size_ + size) + 1`

If `s->size_` is already near `SIZE_MAX`, the addition wraps before `upb_String_Reserve()` is considered. That can incorrectly skip the reserve path and make the later `memcpy(s->data_ + s->size_, data, size)` compute a destination pointer before the start of the buffer.

In the validated harness, setting `s->size_ = SIZE_MAX - 3` and appending 8 bytes wraps the computed sum to `4`, bypasses reserve, and turns the copy destination into `storage - 4`. ASan then reports a stack-buffer-underflow on the write.

## Vulnerable Code

```c
UPB_INLINE bool upb_String_Append(upb_String* s, const char* data,
                                  size_t size) {
  if (s->capacity_ <= s->size_ + size) {
    const size_t new_cap = 2 * (s->size_ + size) + 1;
    if (!upb_String_Reserve(s, new_cap)) return false;
  }

  memcpy(s->data_ + s->size_, data, size);
  s->size_ += size;
  s->data_[s->size_] = '\0';
  return true;
}
```

## Impact

1. **Memory corruption:** wrapped pointer arithmetic can make `memcpy()` write before the beginning of the destination buffer.
2. **Availability:** ASan/UBSan builds abort immediately; unchecked builds would execute undefined behavior.
3. **Attack vector:** source consumers that expose `upb_String_Append()` or tokenizer/text-processing paths to untrusted input.

## Reproduction

### Prerequisites

```bash
cd /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf
git checkout 514aceb974fbd55031169b79d2bd9f7646157787
cd /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter
```

### Build the validation harness

```bash
bash bugs/protobuf/protobuf-input-002/validation/build_impact.sh
```

### Execute

```bash
bugs/protobuf/protobuf-input-002/validation/impact_demo
```

## Proof of Concept

The validation PoC initializes a small in-memory `upb_String` and forces the overflow condition directly:

```cpp
alignas(16) char storage[16];
upb_String s = {};
s.size_ = std::numeric_limits<size_t>::max() - 3;
s.capacity_ = sizeof(storage);
s.data_ = storage;

const char payload[] = "OVERFLOW";
const bool ok = upb_String_Append(&s, payload, 8);
```

## ASan / UBSan Evidence

```text
/targets/protobuf/upb/io/string.h:92:19: runtime error: addition of unsigned offset to 0x00016b2c5fa0 overflowed to 0x00016b2c5f9c
SUMMARY: UndefinedBehaviorSanitizer: undefined-behavior .../string.h:92:19
=================================================================
==75034==ERROR: AddressSanitizer: stack-buffer-underflow on address 0x00016b2c5f9c
WRITE of size 8 at 0x00016b2c5f9c thread T0
    #0 __asan_memcpy
    #1 upb_String_Append+0x110
    #2 main+0x26c
SUMMARY: AddressSanitizer: stack-buffer-underflow ... in upb_String_Append+0x110
...
before.size=18446744073709551612
append.size=8
wrapped.sum=4
reserve.branch=0
storage.addr=0x16b2c5fa0
copy.dest=0x16b2c5f9c
```

## Reachability Note

The shipped `builds/protobuf-asan-arm64/lib/libupb.a` in this workspace does not contain tokenizer objects, and a direct reachability probe for `upb_Tokenizer_New()` failed to link:

```text
Undefined symbols for architecture arm64:
  "_upb_Tokenizer_New", referenced from:
      ltmp1 in poc_real-2a8c5d.o
ld: symbol(s) not found for architecture arm64
```

So this report describes a real bug in the inline helper, but not a fully reachable path in the specific prebuilt archive provided here.

## Suggested Fix

```c
size_t new_size;
if (__builtin_add_overflow(s->size_, size, &new_size)) return false;

if (s->capacity_ <= new_size) {
  size_t new_cap;
  if (__builtin_mul_overflow(new_size, 2, &new_cap) ||
      __builtin_add_overflow(new_cap, 1, &new_cap)) {
    return false;
  }
  if (!upb_String_Reserve(s, new_cap)) return false;
}

memcpy(s->data_ + s->size_, data, size);
s->size_ = new_size;
s->data_[s->size_] = '\0';
```

## Notes

- The most credible downstream consumers are tokenizer/text-processing flows built from source.
- In sanitised builds this is an immediate crash. In non-sanitised builds it is a genuine out-of-bounds write primitive.
