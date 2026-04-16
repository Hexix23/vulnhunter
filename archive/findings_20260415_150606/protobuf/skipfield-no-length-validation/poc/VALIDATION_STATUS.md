# VALIDATION_STATUS.md

## Finding: skipfield-no-length-validation

**Status:** NO_CRASH

**Validated Against:**
- Library: `libprotobuf.a` (ASan build)
- Build: `builds/protobuf-asan-arm64/`
- Commit: `b1405610a2f03798848b186125cd5a1378d12597`
- Date: 2026-04-15

**Compilation:**
```bash
./build_real.sh
```

**Execution:**
```bash
ASAN_OPTIONS=detect_leaks=0:abort_on_error=0 ./poc_real 2>&1 | tee ../validation/asan_output.txt
```

**Evidence:**
- Payload: unknown length-delimited field with declared length `0x7ffffff0` and only 3 body bytes present
- Runtime output:
  - `payload_size=10`
  - `tag=0x3da`
  - `skip_ok=0`
  - `bytes_until_limit=-1`
- ASan result: no heap-buffer-overflow/use-after-free/OOB report from the targeted `WireFormatLite::SkipField()` path

**Source Basis:**
- `parse_context.cc:749-756` reads the size, then delegates to `ctx->Skip(ptr, size)` or `ctx->AppendString(ptr, size, unknown_)`.
- `parse_context.h:193-219` and `parse_context.h:600-632` bound both operations through `CanReadFromPtr()` / `AppendSize()`.
- `parse_context.cc:548-565` rejects oversized length varints during `ReadSizeFallback()`.
- `wire_format_lite.cc:130-134` returns `false` when `input->Skip(length)` cannot satisfy the requested length.

**Conclusion:** The malformed length-delimited field is rejected safely by the compiled library. This revalidation did not confirm a memory corruption bug for `skipfield-no-length-validation`.
