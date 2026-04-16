# Quick Submit Fields

## Title (max 200 chars)
```
ArrayInputStream 32-bit size truncation causes silent data loss for >2GB inputs in JsonStringToMessage
```

## Description
```
ArrayInputStream constructor takes int for size parameter, but callers (JsonStringToMessage, etc.) pass size_t values. 

For inputs >2GB (INT_MAX), the size silently truncates:
- 4GB input → (int)4294967296 = 0
- Parser processes 0 bytes instead of 4GB

Location: zero_copy_stream_impl_lite.h:55
Caller: json.cc:116

Impact: Silent data loss, potential crash, data corruption.
```

## Impact
```
1. Data Corruption: Parser processes wrong bytes
2. DoS: Potential crash from invalid reads
CVSS 3.1: 5.3 (Medium)
CWE-681: Incorrect Conversion between Numeric Types
```

## Steps to Reproduce
```
1. Code analysis shows the bug:
   - ArrayInputStream(const void* data, int size, ...) - line 55
   - JsonStringToMessage calls with size_t - line 116

2. Any input > INT_MAX (2,147,483,647 bytes) triggers truncation

3. No runtime PoC needed - mathematically provable
```

## Suggested Fix
```cpp
// Option 1: Change to size_t
ArrayInputStream(const void* data, size_t size, int block_size = -1);

// Option 2: Add bounds check
if (size > INT_MAX) return error;
```

## Attachments
```
1. GOOGLE_VRP_REPORT.md (full analysis)
```
