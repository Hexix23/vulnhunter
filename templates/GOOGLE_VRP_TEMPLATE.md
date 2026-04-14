# [Product] [Vulnerability Type]

**Product:** [Product Name]
**Repository:** [GitHub URL]
**Component:** [file path]
**Version:** [version/commit]
**Type:** [CWE Type]
**CVSS 3.1:** [Score] - [Vector]

---

## Vulnerability Description

[Technical description of the bug - what function, what happens, why it's wrong]

```cpp
// Vulnerable code snippet with comments
void VulnerableFunction(const char* input)
{
    char buffer[512];
    strcpy(buffer, input);  // <-- No bounds check
}
```

---

## Impact

1. **[Impact Type 1]:** [Description]
2. **[Impact Type 2]:** [Description]
3. **Attack Vector:** [How attacker triggers this]

---

## Steps to Reproduce

1. Clone repository
2. Compile PoC:

```bash
c++ -fsanitize=address -g -O1 exploit.cpp -o exploit
```

3. Run:

```bash
./exploit [args]
```

---

## ASan Output

```
==PID==ERROR: AddressSanitizer: [error-type]
READ/WRITE of size N at ADDRESS
    #0 function1
    #1 function2
    #2 main
SUMMARY: AddressSanitizer: [error-type] in function
```

---

## LLDB Verification

```
(lldb) print sizeof(buffer)
512

(lldb) print strlen(input)
600

(lldb) expr buffer[511]
'A' (0x41)  <-- Should be '\0'
```

---

## Suggested Fix

```cpp
void FixedFunction(const char* input)
{
    char buffer[512];
    strncpy(buffer, input, sizeof(buffer) - 1);
    buffer[sizeof(buffer) - 1] = '\0';  // Ensure null-termination
}
```

---

## References

- [CWE-XXX](https://cwe.mitre.org/data/definitions/XXX.html)
- [Relevant documentation]
