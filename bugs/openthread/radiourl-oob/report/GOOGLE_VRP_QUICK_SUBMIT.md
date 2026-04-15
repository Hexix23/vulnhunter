# Google VRP Quick Submit - OpenThread RadioUrl OOB Read

## CAMPO 1: Title (max 200 chars)
```
Heap buffer over-read in OpenThread RadioUrl::Init() due to missing null-termination after strncpy()
```

---

## CAMPO 2: The problem (technical description)

```
RadioUrl::Init() in src/posix/platform/radio_url.cpp uses strncpy(mUrl, aUrl, sizeof(mUrl) - 1) to copy URLs into a 512-byte buffer. When the input URL is exactly 511 bytes, strncpy copies bytes 0-510 but does NOT null-terminate the buffer (strncpy only null-terminates when src length < n).

The function then immediately calls Url::Url::Init(mUrl) which computes mEnd = aUrl + strlen(aUrl). Since mUrl[511] contains uninitialized data instead of '\0', strlen() reads past the 512-byte buffer into adjacent heap memory.

Vulnerable code (radio_url.cpp lines 151-153):
    VerifyOrDie(strnlen(aUrl, sizeof(mUrl)) < sizeof(mUrl), OT_EXIT_INVALID_ARGUMENTS);
    strncpy(mUrl, aUrl, sizeof(mUrl) - 1);
    SuccessOrDie(Url::Url::Init(mUrl));

ASan confirms: "heap-buffer-overflow READ of size 513" in ot::Url::Url::Init()

PoC: Create 511-byte URL "spinel+hdlc+uart://AAA..." and pass to RadioUrl constructor.
```

---

## CAMPO 3: Impact

```
1. Information Disclosure: strlen() reads heap memory beyond allocated buffer until null byte found
2. Denial of Service: Crash if read crosses unmapped page boundary
3. Attack Vector: Malicious radio URL parameter to OpenThread POSIX applications

CVSS 3.1: 5.3 (Medium)
CWE-125: Out-of-bounds Read
```

---

## CAMPO 4: Bug type

```
Memory corruption - Heap buffer over-read
```

---

## CAMPO 5: Files to upload

```
1. radiourl_oob.cpp - PoC source code
2. build.sh - Build script with ASan flags
3. asan_output.txt - ASan crash output
4. LLDB_DEBUG_REPORT.md - Step-by-step debugger verification showing mUrl[511] != '\0'
```

---

## Reproduction Commands

```bash
# Build
c++ -fsanitize=address -g -O1 -std=c++17 \
    radiourl_oob.cpp \
    openthread/src/posix/platform/radio_url.cpp \
    openthread/src/lib/url/url.cpp \
    -I openthread -I openthread/src -I openthread/include \
    -o radiourl_oob

# Trigger
./radiourl_oob 511
```

---

## Fix

```cpp
strncpy(mUrl, aUrl, sizeof(mUrl) - 1);
mUrl[sizeof(mUrl) - 1] = '\0';  // Add this line
```
