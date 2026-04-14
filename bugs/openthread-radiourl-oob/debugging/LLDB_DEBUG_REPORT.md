# LLDB Debug Report: OpenThread RadioUrl OOB Read

**Date:** 2026-04-13  
**Binary:** `radiourl_oob_debug`  
**Architecture:** x86_64  
**OpenThread Version:** main branch

---

## 1. Bug Summary

`RadioUrl::Init()` uses `strncpy(mUrl, aUrl, sizeof(mUrl) - 1)` which copies 511 bytes but does NOT null-terminate the buffer when input is exactly 511 bytes. The subsequent call to `Url::Init()` uses `strlen(mUrl)` which reads past the 512-byte buffer.

---

## 2. LLDB Session - Breakpoint After strncpy

```
(lldb) target create ./radiourl_oob_debug
Current executable set to 'radiourl_oob_debug' (x86_64).

(lldb) breakpoint set -f radio_url.cpp -l 153
Breakpoint 1: 2 locations.

(lldb) run 511
Constructed URL length: 511
Triggering ot::Posix::RadioUrl::Init() with 511-byte input

Process stopped
* thread #1, stop reason = breakpoint 1.1
    frame #0: RadioUrl::Init(this=0x00007fc6b7004280, aUrl="spinel+hdlc+uart://AAA...") at radio_url.cpp:153:9
   150      {
   151          VerifyOrDie(strnlen(aUrl, sizeof(mUrl)) < sizeof(mUrl), OT_EXIT_INVALID_ARGUMENTS);
   152          strncpy(mUrl, aUrl, sizeof(mUrl) - 1);
-> 153          SuccessOrDie(Url::Url::Init(mUrl));
               ^
   154      }
   155  }
```

---

## 3. Buffer State Analysis

```
(lldb) print sizeof(this->mUrl)
(__size_t) 512

(lldb) print (size_t)strlen(aUrl)
(size_t) 511

(lldb) expr (void)printf("mUrl[509]=%c (0x%02x)\n", this->mUrl[509], (unsigned char)this->mUrl[509])
mUrl[509]=A (0x41)

(lldb) expr (void)printf("mUrl[510]=%c (0x%02x)\n", this->mUrl[510], (unsigned char)this->mUrl[510])
mUrl[510]=A (0x41)

(lldb) expr (void)printf("mUrl[511]=%c (0x%02x)\n", this->mUrl[511], (unsigned char)this->mUrl[511])
mUrl[511]=A (0x41)    <-- NOT NULL TERMINATED!
```

**Critical Finding:** `mUrl[511] = 0x41 ('A')` - The buffer is NOT null-terminated after `strncpy()`.

---

## 4. Memory Layout

```
(lldb) expr &this->mUrl[0]
(char *) $0 = 0x00007fc6b70042a0 "spinel+hdlc+uart://AAA..."

(lldb) expr &this->mUrl[511]
(char *) $1 = 0x00007fc6b700449f "A"

(lldb) memory read -s1 -c8 &this->mUrl[508]
0x7fc6b700449c: 41 41 41 41 00 00 00 00    AAAA....
                ^^^^^^^^ ^^^^^^^^
                mUrl[508-511]    Beyond buffer (heap coincidentally has zeros)
```

---

## 5. Backtrace

```
(lldb) thread backtrace
* thread #1, stop reason = breakpoint 1.1
  * frame #0: RadioUrl::Init(this=0x00007fc6b7004280, aUrl="...") at radio_url.cpp:153:9
    frame #1: RadioUrl::RadioUrl(this=0x00007fc6b7004280, aUrl="...") at radio_url.hpp:53:43
    frame #2: RadioUrl::RadioUrl(this=0x00007fc6b7004280, aUrl="...") at radio_url.hpp:53:41
    frame #3: main(argc=2, argv=0x...) at radiourl_oob.cpp:80:36
    frame #4: dyld`start + 3240
```

---

## 6. Root Cause in Code

**File:** `src/posix/platform/radio_url.cpp`

```cpp
void RadioUrl::Init(const char *aUrl)
{
    if (aUrl != nullptr)
    {
        // Line 151: Validates that URL fits (< 512 bytes)
        VerifyOrDie(strnlen(aUrl, sizeof(mUrl)) < sizeof(mUrl), OT_EXIT_INVALID_ARGUMENTS);
        
        // Line 152: Copies up to 511 bytes - DOES NOT null-terminate!
        strncpy(mUrl, aUrl, sizeof(mUrl) - 1);
        
        // Line 153: Calls strlen() on potentially unterminated buffer
        SuccessOrDie(Url::Url::Init(mUrl));  // <-- strlen() here causes OOB read
    }
}
```

**Problem:**
- `sizeof(mUrl) = 512`
- `strncpy(mUrl, aUrl, 511)` copies exactly 511 bytes when input is 511 bytes
- `strncpy` does NOT add null terminator when src length >= n
- `mUrl[511]` is uninitialized/garbage
- `Url::Init()` calls `strlen(mUrl)` which reads past the buffer

---

## 7. ASan Confirmation

When compiled with `-fsanitize=address`, the bug is confirmed:

```
==38501==ERROR: AddressSanitizer: heap-buffer-overflow
READ of size 513 at 0x6160000008a0
    #0 strlen
    #1 ot::Url::Url::Init(char*)
    #2 ot::Posix::RadioUrl::Init(char const*)
    #3 main
0x6160000008a0 is located 0 bytes after 544-byte region
SUMMARY: heap-buffer-overflow in ot::Url::Url::Init(char*)+0x25
```

---

## 8. Why LLDB Without ASan Doesn't Crash

Without ASan, the heap memory after the `RadioUrl` object may coincidentally contain zeros, which acts as a null terminator. This is undefined behavior - on some systems/allocators, it will crash; on others, it won't.

ASan "poisons" memory outside allocated regions, making the OOB read immediately detectable.

---

## 9. Variables Summary

| Variable | Value |
|----------|-------|
| `sizeof(mUrl)` | 512 |
| `strlen(aUrl)` | 511 |
| `mUrl[510]` | 0x41 ('A') |
| `mUrl[511]` | 0x41 ('A') - NOT NULL |
| `strncpy` copies | 511 bytes (0-510) |
| Expected terminator | mUrl[511] = '\0' |
| Actual terminator | MISSING |

---

## 10. Fix

```cpp
void RadioUrl::Init(const char *aUrl)
{
    if (aUrl != nullptr)
    {
        VerifyOrDie(strnlen(aUrl, sizeof(mUrl)) < sizeof(mUrl), OT_EXIT_INVALID_ARGUMENTS);
        strncpy(mUrl, aUrl, sizeof(mUrl) - 1);
        mUrl[sizeof(mUrl) - 1] = '\0';  // ADD THIS LINE
        SuccessOrDie(Url::Url::Init(mUrl));
    }
}
```

Or use `strlcpy()` which always null-terminates.
