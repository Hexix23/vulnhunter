# VALIDATION_STATUS.md

## Finding: compute-unknown-fields-overflow

**Status:** CONFIRMED_MEMORY

**Validated Against:**
- Library: `libprotobuf.a` (ASan build)
- Build: `builds/protobuf-asan-arm64/`
- Commit: `b1405610a2f03798848b186125cd5a1378d12597`
- Date: `2026-04-15`

**Source Path:**
- `targets/protobuf/src/google/protobuf/wire_format.h:161`
- `targets/protobuf/src/google/protobuf/io/coded_stream.h`
- `targets/protobuf/src/google/protobuf/io/coded_stream.cc`

**Trigger Summary:**
- A single unknown length-delimited field with size `INT_MAX + 256` is added through public `UnknownFieldSet` APIs.
- `WireFormat::SerializeUnknownFieldsToArray()` constructs `EpsCopyOutputStream` with `static_cast<int>(ComputeUnknownFieldsSize(...))`.
- During serialization, `WriteStringOutline()` passes a `uint32_t size` larger than `INT_MAX` into `WriteRaw(..., int size, ...)`.
- ASan reports a real stack buffer overflow in protobuf library code.

**Compilation:**
```bash
./bugs/protobuf/compute-unknown-fields-overflow/poc/build_real.sh
```

**Execution:**
```bash
ASAN_OPTIONS=detect_leaks=0:abort_on_error=0 \
  ./bugs/protobuf/compute-unknown-fields-overflow/poc/poc_real \
  > bugs/protobuf/compute-unknown-fields-overflow/poc/asan_output.txt 2>&1
```

**Evidence:**
- ASan Output: `bugs/protobuf/compute-unknown-fields-overflow/poc/asan_output.txt`
- Exit Code: `1`

**Stack Trace:**
1. `__asan_memcpy`
2. `google::protobuf::io::EpsCopyOutputStream::WriteStringOutline(...)`
3. `google::protobuf::internal::WireFormat::InternalSerializeUnknownFieldsToArray(...)`
4. `google::protobuf::internal::WireFormat::SerializeUnknownFieldsToArray(...)`
5. `main`

**Conclusion:**
- Confirmed memory corruption in the real compiled protobuf library. The bug is not just a size-calculation inconsistency; the oversized unknown field reaches library serialization and produces an ASan-detected `stack-buffer-overflow`.
