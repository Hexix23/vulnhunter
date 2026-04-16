# VALIDATION_STATUS.md

## Finding: protobuf-python-unknownfields-group-recursion

**Status:** NEEDS_DIFFERENT_BUILD

**Validated Against:**
- Library set: `libprotobufd.a`, `libprotobuf-lited.a`, `libupbd.a`
- Build: `builds/protobuf-asan-arm64/`
- Commit: `514aceb97`
- Date: `2026-04-16`

**Why current build is insufficient:**
- The reported vulnerable code is in `targets/protobuf/python/unknown_fields.c`.
- The available ASan build only contains native protobuf/upb libraries; `build_info.json` lists no Python extension artifact.
- `nm -gU builds/protobuf-asan-arm64/lib/libupbd.a` shows no exported `PyUpb_UnknownFieldSet_*` symbols.
- `find builds/protobuf-asan-arm64/include ...` shows no installed Python extension headers such as `python/unknown_fields.h`.
- A link probe against the real libraries fails because `PyUpb_UnknownFieldSet_NewBare` is undefined.

**Attempts:**
1. Checked `builds/protobuf-asan-arm64/` for prebuilt ASan artifacts. Result: native libraries only.
2. Searched the original build directory `targets/protobuf/build-codex-asan-arm64/`. Result: `libprotobufd.a`, `libprotobuf-lited.a`, `libupbd.a`, `libprotocd.a`; no Python module or bundle.
3. Created a minimal real-library link probe in `poc/poc_real.cpp`. Result: expected link failure because the Python object code is not in the shipped libraries.

**Exact failure:**
```text
Undefined symbols for architecture arm64:
  "_PyUpb_UnknownFieldSet_NewBare", referenced from:
      _main in poc_real-0a826c.o
ld: symbol(s) not found for architecture arm64
clang++: error: linker command failed with exit code 1
```

This failure reproduced across:
- `clang++` with provided flags
- `clang++` plus Homebrew include/library paths
- `clang++ -stdlib=libc++`
- `xcrun clang++`

**Build request needed:**
```json
{
  "finding_id": "protobuf-python-unknownfields-group-recursion",
  "status": "NEEDS_DIFFERENT_BUILD",
  "reason": "Bug is in the protobuf Python extension, not in the native protobuf/upb libraries shipped in builds/protobuf-asan-arm64",
  "build_request": {
    "target_binary": "google.protobuf.pyext._message or the upb-backed Python extension module",
    "source_file": "targets/protobuf/python/protobuf.c and targets/protobuf/python/unknown_fields.c",
    "build_hint": "Build the protobuf Python extension with ASan enabled and run a Python harness that calls google.protobuf.unknown_fields.UnknownFieldSet(message)",
    "why": "PyUpb_UnknownFieldSet_BuildValue() is compiled into the Python extension path, and that code is not present in the current native library build"
  }
}
```

**Conclusion:** The finding could not be validated against the current real compiled artifact because the artifact does not include the vulnerable Python extension code path. A Python-extension ASan build is required before runtime validation is possible.
