# Consensus Report: protobuf-input-002

## Summary

| Metric | Value |
|--------|-------|
| **Confidence Level** | CONFIRMED |
| **Total Score** | 2.0 / 4.0 |
| **Recommendation** | REPORT |

## Validator Results

### ASan Validator
- **Status:** NO_CRASH (-0.3)
- **Evidence:** Real-library reproduction did not reach runtime because `builds/protobuf-asan-arm64/lib/libupb.a` lacks tokenizer objects and the attempted link also reported an ASan version mismatch.
- **Key Finding:** The shipped archive did not provide a linkable path to the vulnerable tokenizer helper, so ASan could not confirm the issue in the compiled library artifact.

### LLDB Validator
- **Status:** STATE_BUG (+0.9)
- **Evidence:** The debug harness proved wrapped arithmetic at runtime: `before.size=18446744073709551612`, `append.size=8`, `wrapped.sum=4`, `reserve.branch=0`, `wrapped.new_cap=9`, `after.size=4`, and `copy.dest` landed 4 bytes before `storage.addr`. UBSan also reported pointer overflow at `targets/protobuf/upb/io/string.h:92`.
- **Key Finding:** Unchecked `size_t` arithmetic bypasses reserve and drives `memcpy()` to an out-of-bounds destination.

### Fresh Validator
- **Status:** FOUND (+1.0)
- **Evidence:** Independent review identified the same unchecked `s->size_ + size` and `2 * (s->size_ + size) + 1` arithmetic with no overflow guard ahead of `memcpy()`.
- **Key Finding:** A fresh pass, without relying on prior runtime notes, reached the same conclusion that append growth can wrap and under-allocate.

### Impact Validator
- **Status:** LIMITED_IMPACT (+0.4)
- **Evidence:** The proof of concept demonstrated a stack-buffer-underflow and process abort, but reachability is limited because the vulnerable `upb` tokenizer path is source-level only in this repository snapshot and is absent from the shipped `libupb.a`.
- **Key Finding:** The bug has concrete memory-safety consequences when compiled in, but practical exposure depends on downstream consumers embedding these sources directly.

## Consensus Analysis

### Agreement Points
- LLDB, Fresh, and Impact all support the core finding that unchecked arithmetic in `upb_String_Append()` can wrap before reserve.
- Runtime evidence shows the wrapped sum bypasses growth and redirects `memcpy()` to an invalid destination.
- Independent static review confirmed the same flaw without relying on the runtime harness.

### Disagreement Points
- ASan did not reproduce the issue against the provided compiled archive because the relevant tokenizer objects are not present in the shipped library build.

### Confidence Factors
- [+] Independent fresh validation matched the original root cause.
- [+] Runtime state captured the wrapped arithmetic and invalid copy destination.
- [+] Impact validation demonstrated actual memory corruption behavior when the vulnerable code is built into a harness.
- [-] The supplied build artifacts do not expose a direct real-library reproduction path.
- [-] Practical reachability is limited to downstream builds that include the vulnerable `upb` tokenizer/string helpers.

## Recommendation

**REPORT** - The validator set reaches `CONFIRMED` confidence. The bug is technically real and memory-unsafe, but the report should clearly state that the exploit path depends on downstream source inclusion rather than the shipped `libupb.a` artifact in this repository snapshot.

## Category

**Type:** Integer Overflow Leading to Out-of-Bounds Write  
**Impact:** Buffer Underflow / Memory Corruption  
**Severity Estimate:** MEDIUM
