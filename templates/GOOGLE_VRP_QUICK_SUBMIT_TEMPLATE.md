# Google VRP Quick Submit - [Vulnerability Name]

## CAMPO 1: Title (max 200 chars)
```
[Type] in [Product] [Component] due to [root cause]
```

---

## CAMPO 2: The problem (technical description)

```
[Function] in [file:line] does [action] but fails to [check].

When [trigger condition], [what happens].

Vulnerable code ([file] lines X-Y):
    [code snippet]

[Tool] confirms: "[error message]"

PoC: [Brief reproduction steps]
```

---

## CAMPO 3: Impact

```
1. [Impact 1]: [Description]
2. [Impact 2]: [Description]
3. Attack Vector: [How to trigger]

CVSS 3.1: [Score]
CWE-[Number]: [Name]
```

---

## CAMPO 4: Bug type

```
[Category] - [Specific type]
```

---

## CAMPO 5: Files to upload

```
1. exploit.cpp - PoC source code
2. build.sh - Build script with sanitizer flags
3. asan_output.txt - Sanitizer crash output
4. LLDB_DEBUG_REPORT.md - Debugger verification
```

---

## Reproduction Commands

```bash
# Build
[build command]

# Trigger
[run command]
```

---

## Fix

```cpp
[Fixed code]
```
