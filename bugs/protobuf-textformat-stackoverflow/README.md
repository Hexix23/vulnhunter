# Bug: Protocol Buffers TextFormat Stack Overflow

**ID:** protobuf-textformat-stackoverflow  
**Severity:** HIGH (DoS)  
**Status:** Ready for VRP submission  
**Target:** Google Protocol Buffers (protobuf)  
**Affected:** `TextFormat::Parser` in all C++ implementations  

---

## Summary

`TextFormat::Parser` has `recursion_limit_ = INT_MAX` (2,147,483,647), allowing stack overflow via deeply nested messages (~10,000 levels).

In contrast, `CodedInputStream` (binary proto) has a safe limit of 100.

## Root Cause

```cpp
// text_format.cc:1940
ParserImpl::ParserImpl(...) 
    : recursion_limit_(std::numeric_limits<int>::max())  // <- BUG
```

## Evidence

| Metric | Value |
|--------|-------|
| Crash signal | EXC_BAD_ACCESS / SIGSEGV |
| Recursive frames (LLDB) | 8,431 |
| Crash depth | ~10,000 nested messages |
| recursion_limit_ | 2,147,483,647 (INT_MAX) |
| Safe limit (binary proto) | 100 |

## Files

```
poc/
  poc_stack_overflow.cpp    # PoC source code
  poc_vulnerable_debug      # Compiled binary with debug symbols
  node.proto                # Protobuf schema for recursive message

analysis/
  STACK_OVERFLOW_ANALYSIS.md
  EVIDENCE_SUMMARY.md

debugging/
  LLDB_PASOS_EXACTOS.md     # Step-by-step LLDB tutorial
  LLDB_DEBUGGING_REPORT.md  # Debug session results

report/
  GOOGLE_VRP_FINAL_REPORT.md
  GOOGLE_VRP_SUBMISSION_GUIDE.md
```

## Reproduce

```bash
# 1. Compile PoC
cd poc/
clang++ -g -O0 -std=c++17 \
  -I/path/to/protobuf/include \
  -L/path/to/protobuf/lib \
  poc_stack_overflow.cpp node.pb.cc \
  -lprotobuf -o poc_vulnerable_debug

# 2. Run
./poc_vulnerable_debug
# Crashes at depth ~10,000

# 3. Debug with LLDB
lldb ./poc_vulnerable_debug
(lldb) run
# ... EXC_BAD_ACCESS ...
(lldb) bt
# Shows 8000+ recursive frames
(lldb) script print(sum(1 for f in lldb.process.GetSelectedThread() if 'ConsumeFieldMessage' in str(f)))
# Output: 8431
```

## LLDB Commands Used

```
bt                              # Backtrace
frame select 0                  # Go to crash frame
frame variable                  # Local variables
register read rsp rbp           # Stack/base pointers
script print(sum(...))          # Count recursive frames
```

## Fix Recommendation

```cpp
// Change from:
recursion_limit_(std::numeric_limits<int>::max())

// To:
recursion_limit_(100)  // Same as CodedInputStream
```

## Timeline

- 2026-04-12: Vulnerability identified
- 2026-04-13: PoC developed and tested
- 2026-04-13: LLDB debugging completed (8,431 recursive frames)
- Pending: Google VRP submission
