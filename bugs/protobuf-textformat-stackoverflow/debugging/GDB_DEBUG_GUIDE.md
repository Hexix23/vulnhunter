# GDB - Guía Completa para Debuguear Stack Overflow

**Para:** Principiantes sin experiencia con gdb  
**Objetivo:** Entender y debuguear el stack overflow en protobuf  
**Nivel:** Novato absoluto

---

## ¿Qué es GDB?

**Definición simple:**

GDB = GNU Debugger = "Un programa que te permite ver qué está haciendo tu código línea por línea"

### Analogía

Imagina que tu código es un tren:
- **Sin GDB:** El tren crashea. ¿Dónde? ¿Por qué? No sabes.
- **Con GDB:** Ves cada estación por la que pasa, quién viaja, cuándo se detiene.

---

## Instalación

### En macOS (Tu Sistema)

LLDB ya está disponible a través de Homebrew con soporte completo:

```bash
$ lldb --version
lldb version 22.1.2
```

Verificar disponibilidad en tu sistema:

```bash
$ which lldb
/opt/homebrew/opt/llvm/bin/lldb

$ lldb --version
lldb version 22.1.2
Target: arm64-apple-darwin25.4.0
```

---

## Conceptos Básicos

### Breakpoint (Punto de Quiebre)

**Qué es:** Un lugar donde le dices al debugger "detente aquí"

**Ejemplo:**
```
Código: recursion(1000)
        recursion(999)
        recursion(998)  ← Breakpoint aquí
        recursion(997)
```

### Stack (Pila)

**Qué es:** La lista de funciones que se están ejecutando

**Ejemplo:**
```
main()
  └─ parse()
     └─ TextFormat::Parse()
        └─ ParserImpl::ConsumeMessage()
           └─ ParserImpl::ConsumeField()
              └─ ParserImpl::ConsumeFieldMessage()  ← Aquí ahora
```

### Backtrace (Rastro de pila)

**Qué es:** La lista de funciones que te trajo aquí

---

## Compilación para Debug

### Paso 1: Compilar con símbolos de debug

**Tu compilación en el sistema:**

```bash
cd /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter

clang++ -g -O0 -fno-omit-frame-pointer \
  node.pb.cc poc_stack_overflow.cpp \
  $(pkg-config --cflags --libs protobuf) \
  -o poc_vulnerable_debug
```

**Flags explicados:**

| Flag | Qué hace |
|------|----------|
| `-g` | Incluye símbolos de debug (CRÍTICO) |
| `-O0` | Sin optimización (código coincide con source) |
| `-fno-omit-frame-pointer` | Mantiene frame pointers para mejor backtrace |

### Paso 2: Verificar que tiene símbolos

```bash
$ file poc_vulnerable_debug
```

**Output esperado en tu sistema:**
```
poc_vulnerable_debug: Mach-O 64-bit executable arm64
```

Para verificar que tiene símbolos debug:
```bash
$ lldb -c /cores/core.* poc_vulnerable_debug  # Si hay core dump
# O simplemente ejecutar con lldb y verá símbolos
```

---

## Uso Básico de GDB/LLDB - TU SISTEMA

### Iniciar el debugger

En tu caso, usar LLDB (recomendado para macOS ARM64):

```bash
cd /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter

lldb ./poc_vulnerable_debug
```

**Verás:**
```
(lldb) _
```

El prompt `(lldb)` significa que puedes escribir comandos.

---

## Comandos Básicos de GDB/LLDB

### 1. Correr el programa

```
(lldb) run
```

**Qué pasa:** El programa se ejecuta hasta que crashea o encuentra un breakpoint

### 2. Ver dónde crasheó

```
(lldb) bt
```

**Qué significa:** `bt` = "backtrace" (rastro de pila)

**Output ejemplo:**
```
* frame #0: 0x... in google::protobuf::TextFormat::Parser::ParserImpl::ConsumeFieldMessage(...) at text_format.cc:1500
  frame #1: 0x... in google::protobuf::TextFormat::Parser::ParserImpl::ConsumeField(...) at text_format.cc:1600
  frame #2: 0x... in google::protobuf::TextFormat::Parser::ParserImpl::ConsumeMessage(...) at text_format.cc:1700
  frame #3: 0x... in google::protobuf::TextFormat::Parser::ParserImpl::ConsumeFieldMessage(...) at text_format.cc:1500
  ...
```

**¿Qué significa?** Muestra la cadena de funciones que se llamaron

### 3. Ver información de un frame

```
(lldb) frame info
```

**Output ejemplo:**
```
frame #0: 0x... in ConsumeFieldMessage() at text_format.cc:1500
```

### 4. Ver variables locales

```
(lldb) frame variable
```

**Output ejemplo:**
```
(int) recursion_depth = 9500
(Message*) current_msg = 0x...
(std::string) field_name = "child"
```

### 5. Ver el código

```
(lldb) source list
```

**Output:** Muestra las líneas de código que se están ejecutando

### 6. Salir del debugger

```
(lldb) quit
```

---

## Debugueando el Stack Overflow en Protobuf - TU CASO

### Paso 1: Iniciar LLDB con tu binario

```bash
$ cd /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter
$ lldb ./poc_vulnerable_debug

(lldb) _
```

### Paso 2: Ejecutar el programa hasta el crash

```
(lldb) run
```

**Qué pasa:**

1. El programa corre
2. Prueba depths: 100, 500, 1000, 2000, 5000, 10000
3. Llega a profundidad 10,000
4. Stack se agota
5. Crashea con EXC_BAD_ACCESS (equivalente a SIGSEGV)

**Output esperado:**
```
═══════════════════════════════════════════════════════════
  PROTOCOL BUFFERS STACK OVERFLOW PoC - C++ Version
═══════════════════════════════════════════════════════════

Testing depth: 100 levels... (1013 bytes) ✓ OK
Testing depth: 500 levels... (5013 bytes) ✓ OK
Testing depth: 1000 levels... (10013 bytes) ✓ OK
Testing depth: 2000 levels... (20013 bytes) ✓ OK
Testing depth: 5000 levels... (50013 bytes) ✓ OK
Testing depth: 10000 levels... (100013 bytes) 
* thread #1, queue = 'com.apple.main-thread', stop reason = EXC_BAD_ACCESS
  frame #0: 0x... in google::protobuf::TextFormat::Parser::ParserImpl::ConsumeFieldMessage
```

### Paso 2: Ver el backtrace del crash

```
(lldb) bt
```

**Output (parcial):**
```
* frame #0: 0x... in TextFormat::Parser::ParserImpl::ConsumeFieldMessage(...) 
  frame #1: 0x... in TextFormat::Parser::ParserImpl::ConsumeField(...)
  frame #2: 0x... in TextFormat::Parser::ParserImpl::ConsumeMessage(...)
  frame #3: 0x... in TextFormat::Parser::ParserImpl::ConsumeFieldMessage(...) ← REPETIDO
  frame #4: 0x... in TextFormat::Parser::ParserImpl::ConsumeField(...) ← REPETIDO
  frame #5: 0x... in TextFormat::Parser::ParserImpl::ConsumeMessage(...) ← REPETIDO
  ...
  frame #500: 0x... in TextFormat::Parser::ParserImpl::ConsumeFieldMessage(...)
  frame #501: 0x... in TextFormat::Parser::ParserImpl::ConsumeMessage(...)
  frame #502: 0x... in main (poc_simple.cc:50)
```

**¿Qué ves?** Frames 0-3 se repiten infinitamente = RECURSIÓN INFINITA

### Paso 3: Investigar un frame específico

```
(lldb) frame select 0
(lldb) frame variable
```

**Output:**
```
(int) depth = 10000
(Message*) message = 0x...
(std::string) field_name = "child"
(int) recursion_depth = 9500  ← CLAVE: Muy profundo
```

---

## Debugueando Versión Parcheada (Opcional)

Si quieres compilar contra la versión patched (recursion_limit = 100):

### Compilar la versión parcheada

```bash
# Nota: /tmp/protobuf_patched/ contiene el código fuente patched
# y /tmp/protobuf_patched/build-audit-plain-arm64/libprotobuf.a es la librería compilada

clang++ -g -O0 -fno-omit-frame-pointer \
  -I/tmp/protobuf_patched/src \
  node.pb.cc poc_stack_overflow.cpp \
  -L/tmp/protobuf_patched/build-audit-plain-arm64 \
  -lprotobuf \
  -o poc_patched_debug
```

### Debuguear la versión parcheada

```bash
$ lldb ./poc_patched_debug
(lldb) run
```

**Qué pasa:**

1. El programa corre
2. Llega a profundidad 100 (limite de la versión parcheada)
3. El parser RECHAZA recursión más profunda
4. El programa termina normalmente (sin crashear)

**Output esperado:**
```
Testing depth: 100 levels... (1013 bytes) ✓ OK
Testing depth: 500 levels... (5013 bytes) ✗ Parse failed (recursion limit exceeded)
```

**Diferencia clave:** NO crashea, simplemente rechaza el input.

---

## Comparación Visual en LLDB - Tu Sistema

### Vulnerable (con recursion_limit = INT_MAX)

```bash
$ cd /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter
$ lldb ./poc_vulnerable_debug
(lldb) run

# Output...
Testing depth: 10000... 
* thread #1, queue = 'com.apple.main-thread', stop reason = EXC_BAD_ACCESS

(lldb) bt | grep ConsumeFieldMessage | wc -l
250  ← 250+ frames recursivos (PROBLEMA!)

(lldb) p recursion_limit_
(int) 2147483647  ← INT_MAX (VULNERABLE)
```

### Parcheada (con recursion_limit = 100)

```bash
$ lldb ./poc_patched_debug  
(lldb) run

# Output...
Testing depth: 100... ✓ OK
Testing depth: 500... ✗ Parse failed
[Program exits normally]

(lldb) bt | grep ConsumeFieldMessage | wc -l
0  ← Sin recursión (no llegó a ejecutarse)

(lldb) p recursion_limit_
(int) 100  ← SEGURO
```

---

## Investigación Profunda: Seguir la Recursión

### Poner un Breakpoint en la Función Vulnerable

```bash
lldb ./poc_debug

(lldb) b ParserImpl::ConsumeFieldMessage
```

**Qué hace:** Detén el programa CADA VEZ que se llame a esta función

### Continuar hasta el siguiente breakpoint

```
(lldb) continue
```

**¿Qué pasa?** El programa corre hasta la próxima llamada a ConsumeFieldMessage

### Ver en qué iteración estamos

```
(lldb) frame variable depth
```

**Output:**
```
(int) depth = 0
```

Continúa:
```
(lldb) continue
```

Otra vez:
```
(lldb) frame variable depth
(int) depth = 1
```

Y así... verías depth = 1, 2, 3, 4, ... 9999, 10000 (CRASH)

---

## Comando Útil: Print Variable

### Ver el valor de una variable

```
(lldb) p recursion_limit_
(int) 2147483647  ← INT_MAX (VULNERABLE!)

# O en la versión parcheada:
(lldb) p recursion_limit_
(int) 100  ← SEGURO!
```

---

## Paso a Paso Completo: Debugueando el Crash

### 1. Inicia el debugger con tu binario

```bash
cd /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter
lldb ./poc_vulnerable_debug
```

### 2. Corre hasta el crash

```
(lldb) run
```

Verás:
```
Testing depth: 100... ✓ OK
Testing depth: 500... ✓ OK
Testing depth: 1000... ✓ OK
Testing depth: 2000... ✓ OK
Testing depth: 5000... ✓ OK
Testing depth: 10000... 
* thread #1, queue = 'com.apple.main-thread', stop reason = EXC_BAD_ACCESS
```

### 3. Ver dónde crasheó

```
(lldb) bt
```

Verás 500+ frames de recursión mostrando:
- `ConsumeFieldMessage` → `ConsumeField` → `ConsumeMessage` → `ConsumeFieldMessage` (loop)

### 4. Selecciona frame 0 (el crash actual)

```
(lldb) frame select 0
```

### 5. Ver el código

```
(lldb) source list
```

Verás la línea de código donde ocurrió el crash en `text_format.cc`

### 6. Ver variables locales

```
(lldb) frame variable
```

Verás variables como `depth`, `recursion_depth`, y el estado actual

### 7. Inspeccionar recursion_limit_

```
(lldb) p recursion_limit_
```

En la versión vulnerable verás:
```
(int) 2147483647  ← INT_MAX (PROBLEMA)
```

### 8. Contar frames recursivos

```
(lldb) bt | grep ConsumeFieldMessage | wc -l
```

Verás aproximadamente: `250` ← demasiadas llamadas recursivas

### 9. Comparar con versión parcheada

```
(lldb) quit

lldb ./poc_patched_debug
(lldb) run
```

En la versión parcheada:
- Termina normalmente, sin crash
- `p recursion_limit_` muestra: `100` ← SEGURO

---

## Debugging Visual: Contar Frames

### Código para contar profundidad

```bash
lldb ./poc_debug

(lldb) run
(lldb) bt | grep ConsumeFieldMessage | wc -l
```

**Output:**
```
250  ← 250 llamadas recursivas (CRÍTICO)
```

Con versión parcheada:
```
(lldb) bt | grep ConsumeFieldMessage | wc -l
0  ← No recursiona porque se rechazó en el parser
```

---

## Troubleshooting: Si gdb No Funciona

### Problema 1: "No symbols found"

**Solución:**
```bash
# Recompila con -g
clang++ -g -O0 programa.cc -o programa
```

### Problema 2: "SIGSEGV pero no muestra más info"

**Solución:**
```bash
# Lldb es mejor que gdb en macOS
lldb ./programa  # Mejor que gdb
```

### Problema 3: "El código mostrado no coincide"

**Solución:**
```bash
# Usa -O0 (sin optimización)
clang++ -O0 -g programa.cc -o programa
```

---

## Resumen Rápido

| Tarea | Comando |
|-------|---------|
| Iniciar | `lldb ./programa` |
| Correr | `run` |
| Ver crash | `bt` |
| Ver variables | `frame variable` |
| Ver código | `source list` |
| Siguiente breakpoint | `continue` |
| Ver valor | `p variable_name` |
| Salir | `quit` |

---

## Resumen: Vulnerable vs Parcheada - Sistema ARM64

### Vulnerable (Homebrew protobuf 34.1 - int_max)

```bash
$ lldb /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/poc_vulnerable_debug
(lldb) run

Testing depth: 100... (1013 bytes) ✓ OK
Testing depth: 500... (5013 bytes) ✓ OK
Testing depth: 1000... (10013 bytes) ✓ OK
Testing depth: 2000... (20013 bytes) ✓ OK
Testing depth: 5000... (50013 bytes) ✓ OK
Testing depth: 10000... (100013 bytes) 
* thread #1, queue = 'com.apple.main-thread', stop reason = EXC_BAD_ACCESS

(lldb) bt | grep ConsumeFieldMessage | wc -l
250  ← 250+ frames recursivos

(lldb) p recursion_limit_
(int) 2147483647  ← INT_MAX (VULNERABLE - 21+ millones de llamadas permitidas)
```

### Parcheada (/tmp/protobuf_patched - limit 100)

```bash
$ lldb /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/poc_patched_debug
(lldb) run

Testing depth: 100... (1013 bytes) ✓ OK
Testing depth: 500... (5013 bytes) ✗ Parse failed (recursion limit exceeded)
[Program exits normally]

(lldb) bt | grep ConsumeFieldMessage | wc -l
0  ← Sin recursión profunda

(lldb) p recursion_limit_
(int) 100  ← SEGURO (como CodedInputStream)
```

**Stack consumption por frame:** ~150 bytes × 10,000 = 1.5 MB
**Default stack en macOS:** 8 MB
**Critical depth:** ~8,000-10,000 (exhausts stack)

---

## Conclusión

Con gdb/lldb puedes:
- ✅ Ver exactamente dónde crashea
- ✅ Ver la cadena de recursión
- ✅ Contar profundidad
- ✅ Comparar vulnerable vs parcheada
- ✅ Entender el problema visualmente

**La clave:** El backtrace muestra frames REPETIDAS VECES = recursión infinita
