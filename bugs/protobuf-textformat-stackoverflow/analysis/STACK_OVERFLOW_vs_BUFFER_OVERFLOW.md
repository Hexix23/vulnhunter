# Stack Overflow por Recursión vs Buffer Overflow

## La Pregunta del Usuario

> "¿El stack overflow no es sobrescribir la variable para llegar a la parte del stack que quieres?"

**Excelente pregunta.** Estos son DOS cosas diferentes.

---

## Tipo 1: Buffer Overflow (Escritura más allá de límite)

### Qué es:
Escribir más bytes de los que cabe en un buffer → sobrescribe variables cercanas

### Ejemplo de código vulnerable:
```cpp
void vulnerable_function() {
    char buffer[100];  // 100 bytes en el stack
    strcpy(buffer, user_input);  // Si input > 100 bytes, overflow!
}

Stack layout:
┌──────────────────────┐
│ return_address (8B)  │ ← Se sobrescribe
├──────────────────────┤
│ saved_rbp (8B)       │ ← Se sobrescribe
├──────────────────────┤
│ buffer[100]          │ ← Se escribe más aquí
│ (Buffer allocation)  │
│ (se desborda aquí)   │ ← Escritura más allá del límite
└──────────────────────┘
```

**Cómo explotar:** Sobrescribir return_address con dirección de shellcode

---

## Tipo 2: Stack Overflow por Recursión (Agotamiento de espacio)

### Qué es:
Hacer recursión tan profunda que cada llamada consume stack space hasta agotarlo

### Ejemplo de código vulnerable:
```cpp
void recursive_function(int level) {
    if (level > 0) {
        int local_var[50];  // 200 bytes por nivel
        recursive_function(level - 1);  // Llamada recursiva
    }
}

// Call:
recursive_function(50000);  // 50,000 llamadas anidadas

Stack layout (side view):
Stack bottom ┌────────────────────┐ 8 MB límite
             │ (vacío)            │
             ├────────────────────┤
             │ recursive_function │ Nivel 49,999
             ├────────────────────┤
             │ recursive_function │ Nivel 49,998
             ├────────────────────┤
             │ recursive_function │ Nivel 49,997
             ├────────────────────┤
             │         ...        │
             ├────────────────────┤
             │ recursive_function │ Nivel 2
             ├────────────────────┤
             │ recursive_function │ Nivel 1 (main)
Stack top    └────────────────────┘

Si cada level usa 200 bytes:
50,000 × 200 = 10 MB > 8 MB disponible → CRASH
```

**Cómo explotar:** No hay explotación. Es solo DoS (crash).

---

## En el Caso de TextFormat::Parser

### ¿Cuál es?

**Es Tipo 2: Stack Overflow por Recursión**

### Evidencia de que NO es buffer overflow:

#### 1. El código NO escribe más allá de límites
```cpp
// En ParserImpl::ParseMessage()
std::string field_name;
int field_value;

// El parser lee el input y lo asigna correctamente
// No hay escritura sin límites
// No hay strcpy(), no hay memcpy() sin tamaño

// Solo hay: recursión
if (field_is_message) {
    ParseMessage(nested_descriptor, ...);  // ← SOLO ESTO
}
```

#### 2. El buffer NO se desborda
```cpp
// El parser lee campos de forma segura:
- Lee el nombre del campo
- Busca el descriptor
- Asigna el valor correctamente
- NO hay escritura más allá del tamaño de variable
```

#### 3. El único problema es la recursión

```cpp
// Cada recursión agrega un stack frame:
ParseMessage() {
    [frame for level 1: 200 bytes]
    ParseMessage() {         // Recursión
        [frame for level 2: 200 bytes]
        ParseMessage() {     // Recursión
            [frame for level 3: 200 bytes]
            ...
            [frame for level 50,000: 200 bytes]
            Stack agotado aquí → CRASH
        }
    }
}
```

---

## Comparación Visual

### Buffer Overflow (lo que preguntaste)
```
char buffer[100];
strcpy(buffer, huge_input);  // 10,000 bytes

Memoria del stack:
┌──────────────────────┐
│ return_address ← Se sobrescribe aquí
│ "A"*206 (shellcode)  |
│ "A"*100 (llena buffer)|
└──────────────────────┘

Resultado: Salto a shellcode → Ejecución de código arbitrario
```

### Stack Overflow por Recursión (nuestro caso)
```
void parse(level) {
    if (level > 50000) return;
    int local_var;  // ~200 bytes de stack frame
    parse(level + 1);  // Recursión
}

Memoria del stack:
┌──────────────────────┐
│ [frame para level 50,000] ← Stack límite alcanzado
│ [frame para level 49,999] |
│ [frame para level 49,998] |
│                 ...       |
│ [frame para level 2]      |
│ [frame para level 1]      |
└──────────────────────┘

Resultado: Stack exhaustado → SIGSEGV (no hay ejecución de código)
```

---

## ¿Cómo lo sabemos que es recursión, no buffer overflow?

### 1. Inspección del código fuente

**No hay ninguna función vulnerable a buffer overflow en ParserImpl:**

```cpp
// ✗ NO hay strcpy
// ✗ NO hay memcpy sin tamaño
// ✗ NO hay gets()
// ✗ NO hay sprintf sin límite

// ✓ SÍ hay recursión incondicional para mensajes anidados
if (field->type() == TYPE_MESSAGE) {
    ParseMessage(nested_descriptor, ...);  // ← SOLO ESTO
}
```

### 2. El crash viene de agotamiento de stack, no de corrupción de memoria

**Stack overflow por recursión:**
- Crash tipo: SIGSEGV (signal 11)
- Causa: Page fault al acceder a memoria no mapeada abajo del stack
- Stack pointer intenta crecer más allá del límite
- No hay corrupción de datos, solo crash

**Buffer overflow:**
- Crash tipo: También SIGSEGV, pero precedido de corrupción
- Causa: Escritura más allá de límite del buffer
- Valores de variables se corrompen
- Pueden explotar cambiando valores

### 3. No hay patrón de explotación

Con buffer overflow podrías:
- Sobrescribir return_address → saltar a shellcode
- Sobrescribir funciones pointers → llamar a función arbitraria
- Cambiar variables globales

Con stack overflow por recursión:
- No hay "qué sobrescribir"
- Solo agotamiento de espacio
- No hay ejecución de código arbitrario
- Solo DoS

---

## Prueba Definitiva: Gdb Stack Trace

Si ejecutamos la PoC bajo gdb y hacemos crash, veríamos:

### Buffer Overflow (si fuera):
```
Program received signal SIGSEGV, Segmentation fault.
0x00007ffffffde000 in ?? ()  ← Dirección extraña (shellcode)

Backtrace:
#0 0x00007ffffffde000 in ?? ()
#1 0x00401234 in main ()  ← Saltó a dirección inesperada
```

### Stack Overflow por Recursión (nuestro caso):
```
Program received signal SIGSEGV, Segmentation fault.
0x00007ffff7xxx in google::protobuf::TextFormat::ParserImpl::ParseMessage()

Backtrace (1000+ frames, all the same function):
#0 ParseMessage() at text_format.cc:888
#1 ParseMessage() at text_format.cc:888
#2 ParseMessage() at text_format.cc:888
#3 ParseMessage() at text_format.cc:888
...
#49999 ParseMessage() at text_format.cc:888
#50000 ParseMessage() at text_format.cc:888  ← Stack exhausted here
```

El backtrace muestra **la MISMA función recursiva miles de veces**.

---

## Conclusión

**El usuario tiene razón en preguntar, pero estos son casos diferentes:**

- ❌ **NO es buffer overflow** (escritura más allá de límites)
- ✅ **SÍ es stack overflow por recursión** (agotamiento de espacio)

La diferencia es:
- Buffer overflow = **exploitable** (cambiar datos, ejecutar código)
- Stack overflow por recursión = **solo DoS** (crash, no execución de código)

En este caso de protobuf: **Puro DoS por recursión profunda sin límite.**
