# Plan: PoC Real contra Librería Vulnerable de Protobuf

## Objetivo
Ejecutar **realmente** el PoC contra `TextFormat::Parser` compilado para ver el **SIGSEGV real**, no simulado.

## Pasos

### 1. ✅ Compilar protobuf para x86_64
- Directorio: `build-audit-plain-x86/`
- Comando: `ninja -j4`
- Resultado: `libprotobuf.a` (x86_64)

**Estado:** En progreso (~5-10 minutos)

### 2. Compilar PoC contra la librería real
```bash
cd /tmp
g++ -std=c++17 \
  -I/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/src \
  -o poc_real \
  poc_final.cc \
  /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/build-audit-plain-x86/libprotobuf.a \
  -lpthread
```

### 3. Ejecutar PoC con profundidades crecientes
```bash
./poc_real 1000    # Probablemente OK
./poc_real 10000   # Probablemente OK
./poc_real 50000   # Debería causar SIGSEGV (exit 139)
./poc_real 100000  # Definitivamente SIGSEGV
```

## Resultado Esperado

**Con profundidad que causa crash:**
```
Exit code: 139 (128 + 11, donde 11 = SIGSEGV)
Stack trace: ParserImpl::ParseMessage() recursive calls
Message: Segmentation fault: 11
```

## Lo que esto PRUEBA

✅ **Stack overflow real** (no simulado)
✅ **Causado por recursión** en `ParserImpl::ParseMessage()`
✅ **Reproducible** con librería compilada vulnerable
✅ **Reportable** a Google VRP

## Diferencia: Lo que Ya Hemos Probado vs. Lo que Falta

| Prueba | Resultado | ¿Reportable? |
|--------|-----------|-------------|
| Análisis de código (text_format.cc) | recursion_limit = INT_MAX | No - análisis solamente |
| Simulación C++ (poc_simple_recursion) | SIGSEGV a 50K niveles | No - simulado, no real |
| Python TextFormat real | RecursionError a 1K niveles | No - error Python, no crash |
| **PoC C++ real vs libprotobuf** | **SIGSEGV real** | **✅ SÍ - REPORTABLE** |

---

## Por qué es crítico hacer esto

Sin esta prueba real, el reporte diría:
- ❌ "Encontramos INT_MAX en el código"
- ❌ "Predecimos que causaría stack overflow"

Con esta prueba real, el reporte dice:
- ✅ "Compilamos el código vulnerable"
- ✅ "Ejecutamos PoC contra la librería real"
- ✅ "Observamos SIGSEGV a profundidad X"
- ✅ "Esto es un stack overflow real, probado"

## Timeline
- Compilación: ~5-10 minutos
- Compilación PoC: ~30 segundos
- Ejecución y crash: Inmediato
- **Total: ~10-15 minutos**
