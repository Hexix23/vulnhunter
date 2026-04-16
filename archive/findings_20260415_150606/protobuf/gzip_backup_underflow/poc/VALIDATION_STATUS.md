# VALIDATION_STATUS.md

## Finding: gzip_backup_underflow

**Status:** LOGIC_BUG

**Validated Against:**
- Library: `libprotobuf.a`
- Build: `builds/protobuf-asan-arm64/`
- Date: 2026-04-15

**Source Location:**
- `google::protobuf::io::GzipInputStream::BackUp(int count)` in `targets/protobuf/src/google/protobuf/io/gzip_stream.cc`
- The implementation subtracts `count` from `output_position_` without checking that `count <= last Next() size`.

**Compilation:**
```bash
./build_real.sh
```

**Runtime Evidence:**
- `first_size=20`
- `backup_count=52`
- `byte_count_after_backup=72`
- `second_size=52`
- `pointer_delta=32`
- `size_bug=1`
- `pointer_bug=1`
- `count_bug=1`

**Interpretation:**
- No AddressSanitizer report was emitted by the compiled library.
- The real library still reproduces the bug as a logic flaw: an oversized `BackUp()` moves the next returned pointer 32 bytes before the previous buffer start and inflates the reported readable size from 20 to 52 bytes.
- Because the invalid memory is only exposed to the caller and not dereferenced by library code during this run, this is not a `CONFIRMED_MEMORY` result.

**Artifacts:**
- PoC source: `poc_real.cpp`
- Build script: `build_real.sh`
- Runtime output: `asan_output.txt`
- Machine result: `../validation/asan_result.json`

**Conclusion:** Confirmed as a real-library `LOGIC_BUG`, not an ASan-detected memory corruption.
