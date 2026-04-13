# AddressSanitizer (ASAN) - Guía Técnica Completa

**Para:** Desarrolladores sin experiencia con herramientas de sanitización  
**Objetivo:** Entender qué es ASAN, cómo usarlo, e interpretar resultados  
**Nivel:** Principiante a Intermedio

---

## ¿Qué es AddressSanitizer (ASAN)?

### Definición Simple

**ASAN es una herramienta que detecta bugs de memoria en tiempo de ejecución.**

Piénsalo así:
- **Tu código:** `ptr[100]` (intenta acceder a memoria que no le pertenece)
- **Sin ASAN:** El programa crashea sin explicación (SIGSEGV)
- **Con ASAN:** Te dice exactamente: "Acceso a memoria inválida en línea X, variable Y"

### ¿Por qué es útil?

| Problema | Sin ASAN | Con ASAN |
|----------|----------|----------|
| Buffer overflow | Crash silencioso | "ERROR: AddressSanitizer: heap-buffer-overflow" |
| Stack overflow | Crash silencioso | "ERROR: AddressSanitizer: stack-overflow" |
| Use-after-free | Comportamiento impredecible | "ERROR: AddressSanitizer: heap-use-after-free" |
| Memory leak | Difícil de encontrar | Reporte de leaks con ubicación exacta |

---

## Cómo Funciona ASAN Internamente

### Paso 1: Compilación

Cuando compilas con `-fsanitize=address`:

```bash
clang++ -fsanitize=address -g program.cc -o program
```

**Qué hace el compilador:**

```
1. Instrumenta el código
   - Agrega checks antes de cada acceso a memoria
   - Inserta calls a funciones de ASAN

2. Enlaza con libasan
   - Agrega runtime library de ASAN
   - Proporciona reporteo de errores

3. Mantiene info de debug
   - Con -g, guarda símbolos para backtrace legible
```

### Paso 2: Ejecución

Cuando ejecutas el programa:

```bash
./program
```

**Qué hace ASAN en tiempo de ejecución:**

```
1. Inicializa "shadow memory"
   - Crea un mapa de qué memoria es válida
   - 1 byte real = 8 bytes de "shadow"
   - Marca: accesible (0), no accesible (1), etc.

2. Intercepta accesos a memoria
   - Antes de cada lectura/escritura
   - Consulta shadow memory
   - Si es inválido: reporta error

3. Mantiene estado
   - Stack frames: qué variable ocupa qué memoria
   - Heap allocations: tamaño, tipo, ubicación
```

### Paso 3: Error Detectado

Cuando detecta un acceso inválido:

```
1. Genera backtrace
   - Muestra la cadena de función calls

2. Analiza memoria
   - Identifica qué variable fue accedida
   - Qué tamaño tiene
   - Qué se intentó hacer

3. Reporta error
   - Tipo específico: stack-overflow, heap-buffer-overflow, etc.
   - Ubicación exacta en código
   - Contexto completo
```

---

## Instalación

### En macOS (Homebrew)

ASAN ya está incluido en Xcode/clang:

```bash
$ clang++ --version
Apple clang version 15.0.0
# ASAN ya está disponible
```

### Verificar disponibilidad

```bash
$ clang++ -fsanitize=address -c test.cc -o test.o
# Si no hay error, ASAN está disponible
```

---

## Uso: Paso a Paso

### Paso 1: Compilar con ASAN

**Sintaxis básica:**

```bash
clang++ -fsanitize=address -g programa.cc -o programa
```

**Flags explicados:**

| Flag | Qué hace |
|------|----------|
| `-fsanitize=address` | Activa AddressSanitizer |
| `-g` | Incluye símbolos de debug (IMPORTANTE) |
| `-O0` | Sin optimización (mejor para debug) |
| `-fno-omit-frame-pointer` | Mantiene frame pointers (mejor backtrace) |

**Ejemplo completo:**

```bash
clang++ -fsanitize=address -g -O0 -fno-omit-frame-pointer \
  programa.cc -o programa
```

### Paso 2: Ejecutar

**Ejecución simple:**

```bash
./programa
```

**Con opciones de ASAN:**

```bash
ASAN_OPTIONS=verbosity=1 ./programa
ASAN_OPTIONS=halt_on_error=1 ./programa  # Detiene en primer error
```

### Paso 3: Interpretar Output

**Output típico de error:**

```
=================================================================
==12345==ERROR: AddressSanitizer: heap-buffer-overflow on address 0x...
    WRITE of size 4 at 0x... thread T0
    Address 0x... is 12 bytes inside a 10-byte region allocated here
    ...
    
SUMMARY: AddressSanitizer: heap-buffer-overflow program.cc:42 in main()
==12345==ABORTING
```

---

## Tipos de Errores que Detecta ASAN

### 1. Heap Buffer Overflow

**Código vulnerable:**

```cpp
#include <stdlib.h>

int main() {
    int* arr = (int*)malloc(10 * sizeof(int));  // Array de 10 ints
    arr[15] = 42;  // ❌ Escribe fuera del rango
    free(arr);
    return 0;
}
```

**Output de ASAN:**

```
ERROR: AddressSanitizer: heap-buffer-overflow on address 0x...
    WRITE of size 4 at 0x... thread T0
    Address 0x... is 20 bytes inside a 40-byte region [0x...,0x...)
    allocated by thread T0 here:
        #0 0x... in __interceptor_malloc (...)
        #1 0x... in main (program.cc:4)
```

### 2. Stack Buffer Overflow

**Código vulnerable:**

```cpp
#include <string.h>

int main() {
    char buffer[10];
    strcpy(buffer, "very long string that exceeds 10 bytes");  // ❌ Overflow
    return 0;
}
```

**Output de ASAN:**

```
ERROR: AddressSanitizer: stack-buffer-overflow on address 0x...
    WRITE of size 38 at 0x... thread T0
    Address 0x... is 0 bytes inside a 10-byte region [0x...,0x...)
    located in stack of thread T0 at offset 32 in frame
        main program.cc:4
```

### 3. Stack Overflow (Recursión)

**Código vulnerable:**

```cpp
void infinite_recursion(int depth) {
    char buffer[1000];
    infinite_recursion(depth + 1);  // ❌ Recursión infinita
}

int main() {
    infinite_recursion(0);
    return 0;
}
```

**Output de ASAN:**

```
ERROR: AddressSanitizer: stack-overflow on address 0x...
    WRITE of size 8 at 0x... thread T0
    
SUMMARY: AddressSanitizer: stack-overflow (program:arm64+0x...) in 
infinite_recursion(int)
```

### 4. Use-After-Free

**Código vulnerable:**

```cpp
#include <stdlib.h>

int main() {
    int* ptr = (int*)malloc(4);
    free(ptr);
    *ptr = 42;  // ❌ Uso después de liberar
    return 0;
}
```

**Output de ASAN:**

```
ERROR: AddressSanitizer: heap-use-after-free on address 0x...
    WRITE of size 4 at 0x... thread T0
    Address 0x... is 0 bytes inside a 4-byte region [0x...,0x...)
    freed by thread T0 here:
        #0 0x... in __interceptor_free (...)
        #1 0x... in main (program.cc:5)
```

---

## Caso Real: Stack Overflow en Protocol Buffers

### El Código Vulnerable

**Ubicación:** `src/google/protobuf/text_format.cc:1940`

```cpp
TextFormat::Parser::Parser()
    : recursion_limit_(std::numeric_limits<int>::max())  // INT_MAX
{}
```

**Problema:** `recursion_limit = INT_MAX` permite recursión ilimitada

### Compilación con ASAN

```bash
clang++ -std=c++17 -fsanitize=address -g \
  node.pb.cc poc_pbuf_deep.cc \
  $(pkg-config --cflags --libs protobuf) \
  -o poc_pbuf_asan
```

### Ejecución

```bash
./poc_pbuf_asan
```

### Output Real

```
Testing protobuf TextFormat::Parser - DEEP RECURSION

Depth 5000... ✓ OK
Depth 8000... ✓ OK
Depth 10000...
=================================================================
==56091==ERROR: AddressSanitizer: stack-overflow on address 0x00016c3f3ff0
READ of size 8 at 0x00016c3f3ff0 thread T0

SUMMARY: AddressSanitizer: stack-overflow (libprotobuf.34.1.0.dylib:arm64+0x114388)
in google::protobuf::MessageLite::New(google::protobuf::Arena*) const+0x48
==56091==ABORTING
```

### Interpretación

**Lo que ASAN nos dice:**

```
1. ERROR: stack-overflow
   → Es un desbordamiento de stack (recursión infinita)

2. Address: 0x00016c3f3ff0
   → Ubicación exacta de la memoria inválida

3. Thread T0: Stack [0x..., 0x...)
   → El stack de este thread se agotó

4. SUMMARY: stack-overflow in MessageLite::New(...)
   → El error ocurre dentro de protobuf

5. Backtrace (no mostrado completo, pero contiene):
   ConsumeFieldMessage() → ConsumeField() → ConsumeMessage() → ...
   → Muestra la recursión infinita
```

---

## Ventajas y Desventajas de ASAN

### ✅ Ventajas

| Ventaja | Descripción |
|---------|-------------|
| **Precisión** | Identifica exactamente qué tipo de error |
| **Ubicación** | Dice dónde ocurre el error |
| **Backtrace** | Muestra la cadena de function calls |
| **Costo bajo** | Solo ~2x overhead en performance |
| **Fácil de usar** | Solo un flag de compilación |
| **Gratuito** | Viene con clang/gcc |

### ❌ Desventajas

| Desventaja | Descripción |
|------------|-------------|
| **Compilación obligatoria** | Debes recompilar con `-fsanitize=address` |
| **Overhead de memoria** | Usa más RAM (shadow memory) |
| **No catch en release** | Típicamente deshabilitado en builds de producción |
| **No detecta todo** | Algunos bugs aún pueden pasar |
| **Falsos positivos** | Raramente reporta errores que no existen |

---

## Opciones de ASAN

### Variables de Entorno

```bash
# Verbosidad
ASAN_OPTIONS=verbosity=0     # Silencioso
ASAN_OPTIONS=verbosity=1     # Normal
ASAN_OPTIONS=verbosity=2     # Detallado

# Comportamiento
ASAN_OPTIONS=halt_on_error=1     # Detén en primer error
ASAN_OPTIONS=halt_on_error=0     # Continúa después de error

# Memoria
ASAN_OPTIONS=allocator_may_return_null=1   # Devuelve null en OOM
```

**Ejemplo:**

```bash
ASAN_OPTIONS=verbosity=1:halt_on_error=1 ./programa
```

---

## Cuándo Usar ASAN

### ✅ Usa ASAN para:

- Debuggear bugs de memoria en desarrollo
- Verificar que el código es memory-safe
- Encontrar stack overflows
- Identificar heap leaks
- Confirmar tipos de errores en crí­ticos

### ❌ NO uses ASAN para:

- Reporte de bugs a empresas (no lo piden)
- Producción (desempeño)
- Código que ya funciona (overhead innecesario)

---

## En el Contexto de Google VRP

### ¿Necesitas ASAN para reportar?

**Respuesta: NO**

**Por qué:**
- Google quiere ver bugs reproducibles
- Un crash es un crash, ASAN es solo confirmación
- El PoC sin ASAN es suficiente

**Cuándo SÍ usar ASAN:**
- Para tu propio debugging
- Para confirmar el tipo de error
- Para documentación técnica

**Lo que Google espera:**
```
✅ PoC que crashea
✅ Crash reproducible
✅ Explicación técnica
❌ No necesita ASAN
```

---

## Comparación: Con vs Sin ASAN

### Sin ASAN

```bash
$ ./poc_stack_overflow

Testing depth: 100 levels... ✓ PARSED OK
Testing depth: 5000 levels... ✓ PARSED OK
Testing depth: 10000 levels... Segmentation fault: 11
```

**Conclusión:** "Crashea, pero ¿por qué?"

### Con ASAN

```bash
$ ./poc_pbuf_asan

Testing protobuf TextFormat::Parser - DEEP RECURSION

Depth 5000... ✓ OK
Depth 10000...
ERROR: AddressSanitizer: stack-overflow on address 0x...

SUMMARY: AddressSanitizer: stack-overflow in google::protobuf::MessageLite::New()
```

**Conclusión:** "Stack overflow confirmado, ubicación exacta identificada"

---

## Resumen

| Aspecto | Detalles |
|--------|---------|
| **Qué es** | Herramienta de debug que detecta errores de memoria |
| **Cómo funciona** | Instrumenta código, monitorea accesos a memoria |
| **Cómo usar** | Compila con `-fsanitize=address`, ejecuta normalmente |
| **Output** | Tipo de error, ubicación, backtrace |
| **Para Google VRP** | Opcional, no necesario para reportar |
| **Cuándo usar** | Durante desarrollo para debugging |

---

## Ejemplos Prácticos

### Ejemplo 1: Detectar Buffer Overflow

**Código con bug:**
```cpp
#include <stdio.h>
#include <string.h>

int main() {
    char name[5];
    strcpy(name, "Carlos");  // ❌ Buffer de 5, string de 7
    printf("Name: %s\n", name);
    return 0;
}
```

**Compilar:**
```bash
clang++ -fsanitize=address -g overflow.cc -o overflow
```

**Ejecutar:**
```bash
./overflow
```

**ASAN reporta:**
```
ERROR: AddressSanitizer: stack-buffer-overflow
Address 0x... is 0 bytes inside a 5-byte region
WRITE of size 7 at 0x...
```

### Ejemplo 2: Detectar Recursión Infinita

**Código con bug:**
```cpp
void recursive(int n) {
    int arr[1000];
    arr[0] = n;
    recursive(n + 1);  // ❌ Infinito
}

int main() {
    recursive(0);
    return 0;
}
```

**Compilar:**
```bash
clang++ -fsanitize=address -g recursion.cc -o recursion
```

**Ejecutar:**
```bash
./recursion
```

**ASAN reporta:**
```
ERROR: AddressSanitizer: stack-overflow
SUMMARY: AddressSanitizer: stack-overflow in recursive(int)
```

---

## Referencia Rápida

```bash
# Compilar con ASAN
clang++ -fsanitize=address -g -O0 programa.cc -o programa

# Ejecutar con verbose
ASAN_OPTIONS=verbosity=1 ./programa

# Ejecutar y parar en primer error
ASAN_OPTIONS=halt_on_error=1 ./programa

# Ejecutar sin detener
ASAN_OPTIONS=halt_on_error=0 ./programa
```

---

**Conclusión:** ASAN es una herramienta poderosa para debugging, pero para reportar bugs a Google VRP, el crash real es suficiente.
