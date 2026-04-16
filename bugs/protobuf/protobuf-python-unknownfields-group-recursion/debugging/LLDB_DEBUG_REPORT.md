# LLDB Debug Report: protobuf-python-unknownfields-group-recursion

## Build Information

- Build directory: `builds/protobuf-asan-arm64`
- Target source: `targets/protobuf/python/unknown_fields.c`
- Vulnerable function: `PyUpb_UnknownFieldSet_BuildValue()`
- Requested validation path: `google.protobuf.unknown_fields.UnknownFieldSet(message)`

## Executive Summary

Runtime state validation could not be performed against the supplied build because the build only contains native protobuf/upb libraries and does not include the Python extension object code that implements `PyUpb_UnknownFieldSet_BuildValue()`.

The required call path lives in `targets/protobuf/python/unknown_fields.c`, but:

- `builds/protobuf-asan-arm64/build_info.json` lists only `libprotobufd.a`, `libprotobuf-lited.a`, `libupbd.a`, `libutf8_range.a`, and `libutf8_validity.a`.
- No `_message` extension module (`.so`/`.dylib`) exists in the provided build tree.
- `nm -gU builds/protobuf-asan-arm64/lib/libupbd.a` returns no `PyUpb_UnknownFieldSet_*` symbols.
- A debug-only link probe using the provided `compile_flags_debug.txt` and `link_flags_debug.txt` fails with an undefined reference to `_PyUpb_UnknownFieldSet_NewBare`.

Because the vulnerable Python code path is absent from the shipped artifact set, LLDB never has a valid binary to attach to for this finding.

## Environment

- OS: Darwin
- Arch: arm64
- Rosetta: not detected (`sysctl.proc_translated` returned empty / not `1`)

## Evidence

### 1. The vulnerable code path is in the Python extension

Source excerpt from `targets/protobuf/python/unknown_fields.c`:

```c
case kUpb_WireType_StartGroup: {
  PyUpb_UnknownFieldSet* sub = PyUpb_UnknownFieldSet_NewBare();
  if (!sub) return NULL;
  *data = &sub->ob_base;
  return PyUpb_UnknownFieldSet_Build(sub, stream, ptr, field_number);
}
```

This is the recursive path that must be exercised to prove the bug, but it is compiled into the Python extension, not the native protobuf C++ libraries.

### 2. The provided build does not contain a Python extension artifact

`build_info.json` for `builds/protobuf-asan-arm64` contains only:

```json
[
  "libprotobuf-lited.a",
  "libprotobufd.a",
  "libupbd.a",
  "libutf8_range.a",
  "libutf8_validity.a"
]
```

No `_message` module or Python extension library is present.

### 3. Symbol-level check shows the Python entry points are absent

Command:

```bash
nm -gU builds/protobuf-asan-arm64/lib/libupbd.a | rg 'PyUpb_UnknownFieldSet|PyUpb_Message_|PyInit|_message'
```

Result:

```text
no matches
```

### 4. Python runtime lookup does not expose the extension path

Command:

```bash
python3 - <<'PY'
import importlib.util
mods = ['google.protobuf', 'google.protobuf.unknown_fields', 'google.protobuf.pyext._message']
for mod in mods:
    spec = importlib.util.find_spec(mod)
    print(mod, '->', spec.origin if spec else None)
PY
```

Observed output:

```text
google.protobuf -> /Users/carlosgomez/.local/lib/python3.10/site-packages/google/protobuf/__init__.py
google.protobuf.unknown_fields -> None
google.protobuf.pyext._message -> None
```

This environment does not provide a loadable local extension module for the vulnerable path.

### 5. Debug-only link probe fails before LLDB can run

Command:

```bash
clang++ $(cat builds/protobuf-asan-arm64/compile_flags_debug.txt) \
  bugs/protobuf/protobuf-python-unknownfields-group-recursion/poc/poc_real.cpp \
  $(cat builds/protobuf-asan-arm64/link_flags_debug.txt) \
  -o /tmp/protobuf-python-unknownfields-link-probe
```

Observed output:

```text
Undefined symbols for architecture arm64:
  "_PyUpb_UnknownFieldSet_NewBare", referenced from:
      _main in poc_real-eb9fbb.o
ld: symbol(s) not found for architecture arm64
clang++: error: linker command failed with exit code 1 (use -v to see invocation)
```

## Retry Summary

1. Checked Rosetta state first. No Rosetta issue found.
2. Looked for a prebuilt Python extension module in the workspace. None found.
3. Checked exported symbols in the provided libraries. The required `PyUpb_UnknownFieldSet_*` symbols are absent.
4. Attempted a debug-only link probe using the provided non-ASan flags. Link failed due to missing Python-extension symbols.

No further LLDB retry is meaningful until a build exists that actually contains the Python extension path.

## Fuzzing-Relevant Input Surfaces

Functions that accept attacker-controlled unknown-field data and would benefit from dedicated fuzz coverage:

1. `PyUpb_UnknownFieldSet_New()` in `targets/protobuf/python/unknown_fields.c`
   - External input: unknown-field blobs attached to a parsed Python protobuf message.
   - Constraints: requires a valid `PyUpb_Message`; iterates `upb_Message_NextUnknown()`.
   - Edge cases: multiple unknown blobs, malformed group endings, empty blobs, very deep nested groups.

2. `PyUpb_UnknownFieldSet_Build()` in `targets/protobuf/python/unknown_fields.c`
   - External input: raw unknown-field wire stream via `upb_EpsCopyInputStream`.
   - Constraints: must consume valid tags until stream end or matching `EndGroup`.
   - Edge cases: unmatched end-group tags, truncated tags, repeated start-group nesting, mixed wire types, nested empty groups.

3. `PyUpb_UnknownFieldSet_BuildValue()` in `targets/protobuf/python/unknown_fields.c`
   - External input: field number, wire type, and the bytes for the current field value.
   - Constraints: `wire_type` must be one of varint/64-bit/32-bit/delimited/start-group.
   - Edge cases: extremely deep `StartGroup` recursion, large delimited sizes, malformed varints, groups with immediate end tags, group-number mismatches.

The highest-value harness is a Python-extension-aware target that parses attacker-controlled wire data into a message, then calls `google.protobuf.unknown_fields.UnknownFieldSet(message)` to force the post-parse recursion path.

## Conclusion

Final status: `NEEDS_DIFFERENT_BUILD`

The finding remains plausible from source review, but this validation run cannot capture LLDB or printf state because the provided build artifacts do not include the vulnerable Python extension implementation. A new build is required for `google.protobuf.pyext._message` or the upb-backed Python extension that compiles `targets/protobuf/python/unknown_fields.c`.
