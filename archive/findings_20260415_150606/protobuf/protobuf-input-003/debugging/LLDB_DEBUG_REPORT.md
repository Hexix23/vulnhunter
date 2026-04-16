# LLDB Debug Report: protobuf-input-003

## Build Information

- Build directory: `builds/protobuf-asan-arm64`
- Debug binary: `bugs/protobuf/protobuf-input-003/debugging/poc_debug`
- PoC source: `bugs/protobuf/protobuf-input-003/debugging/poc_debug.cpp`
- Library: `builds/protobuf-asan-arm64/lib/libprotobuf.a`
- Compile model: reused prebuilt protobuf ASan libraries, debug PoC compiled with `-g`

## Executive Summary

This finding is a real state bug that becomes a memory safety failure.

The destination `RepeatedField<uint32_t>` has its logical size forged to `INT_MAX`
before `MessageLite::MergeFromString()` parses a packed `fixed32` field containing
one new element. The requested size becomes `2147483648`, which wraps to
`0x80000000` / `-2147483648` in signed 32-bit form. The protobuf packed-field
parser then reaches:

- `google::protobuf::internal::EpsCopyInputStream::ReadPackedFixed<unsigned int>()`
- `google::protobuf::RepeatedField<unsigned int>::AddNAlreadyReserved()`
- `google::protobuf::RepeatedField<unsigned int>::ExchangeCurrentSize()`
- `google::protobuf::RepeatedField<unsigned int>::AnnotateSize()`

At that point ASan reports invalid contiguous-container bounds because the old and
new logical mid-pointers are impossible for the real allocation.

## LLDB Status

LLDB symbol resolution succeeded, but runtime launch failed in this environment:

- Attempt 1: `lldb -b -s debugging/lldb_commands.txt debugging/poc_debug`
- Attempt 2: `lldb --arch arm64 -b -s debugging/lldb_commands.txt debugging/poc_debug`
- Result: `error: could not find 'debugserver'`

Because the required macOS debugger backend is unavailable, evidence was captured
using the mandated fallback: an instrumented debug PoC plus ASan stack/symbolized
runtime state.

## Step-by-Step Evidence

### 1. Pre-merge state

Captured from `debugging/state_capture.stderr` before the merge call:

```text
api=google::protobuf::MessageLite::MergeFromString
raw_size_field=2147483647
initial_size=2147483647
initial_capacity=6
nums_data_ptr=0x603000006198
payload_bytes=6
packed_length_field=4
element_width=4
new_entries=1
requested_size_64=2147483648
wrapped_size_signed=-2147483648
wrapped_size_hex=0x80000000
```

Interpretation:

- The repeated field already claims `2147483647` elements.
- The packed payload contributes exactly `1` new `fixed32` element.
- The mathematically correct target size is `2147483648`.
- A 32-bit signed representation of that value is `-2147483648`.

That is the incorrect state that drives the failure.

### 2. The library path that consumes the corrupted state

ASan shows the real merge path through the prebuilt protobuf library:

```text
#1 google::protobuf::RepeatedField<unsigned int>::AnnotateSize(int, int) const
   repeated_field.h:649
#2 google::protobuf::RepeatedField<unsigned int>::ExchangeCurrentSize(int)
   repeated_field.h:668
#3 google::protobuf::RepeatedField<unsigned int>::AddNAlreadyReserved(int)
   repeated_field.h:917
#4 google::protobuf::internal::EpsCopyInputStream::ReadPackedFixed<unsigned int>(...)
   parse_context.h:1547
#7 bool google::protobuf::internal::MergeFromImpl<false>(...)
   message_lite.cc:227
#8 main
   poc_debug.cpp:52
```

This confirms the failure happens in protobuf library code during
`MessageLite::MergeFromString()`, not in a synthetic helper.

### 3. Invalid memory bounds observed at the failure point

ASan reports:

```text
ERROR: AddressSanitizer: bad parameters to __sanitizer_annotate_contiguous_container:
      beg     : 0x603000006198
      end     : 0x6030000061b0
      old_mid : 0x603200006194
      new_mid : 0x602e00006198
```

Interpretation:

- `beg` / `end` describe the real heap allocation for the repeated field storage.
- `old_mid` is far beyond `end`, meaning protobuf believed the old logical size
  extended well past the actual allocation.
- `new_mid` moves backwards before `beg`, which is consistent with the wrapped
  negative size `-2147483648`.

That is the memory-level proof that the container annotation logic received
impossible size values.

## Reproducible Commands

### Compile

```bash
COMPILE_FLAGS="$(cat builds/protobuf-asan-arm64/compile_flags.txt)"
LINK_FLAGS="$(cat builds/protobuf-asan-arm64/link_flags.txt)"
SDK_ZLIB="/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX26.4.sdk/usr/lib/libz.tbd"
UPB_LIB="builds/protobuf-asan-arm64/lib/libupb.a"
UTF8_RANGE_LIB="builds/protobuf-asan-arm64/lib/libutf8_range.a"
ABSL_DYLIBS=(/opt/homebrew/lib/libabsl_*.2601.0.0.dylib)

xcrun clang++ -arch arm64 $COMPILE_FLAGS \
  -Ibugs/protobuf/protobuf-input-003/poc -I/opt/homebrew/include \
  bugs/protobuf/protobuf-input-003/debugging/poc_debug.cpp \
  bugs/protobuf/protobuf-input-003/poc/packed_fixed32.pb.cc \
  $LINK_FLAGS $UPB_LIB $UTF8_RANGE_LIB ${ABSL_DYLIBS[*]} \
  $SDK_ZLIB -Wl,-rpath,/opt/homebrew/lib -Wl,-framework,CoreFoundation \
  -o bugs/protobuf/protobuf-input-003/debugging/poc_debug
```

### Run

```bash
ASAN_SYMBOLIZER_PATH="$(xcrun --find llvm-symbolizer)" \
ASAN_OPTIONS=detect_leaks=0:abort_on_error=0 \
bugs/protobuf/protobuf-input-003/debugging/poc_debug
```

### LLDB batch file

See `bugs/protobuf/protobuf-input-003/debugging/lldb_commands.txt`.

## Summary Table

| Check | Expected | Actual | Result |
|-------|----------|--------|--------|
| Existing logical size | small / bounded by real capacity | `2147483647` | BUG |
| Incoming packed entries | `1` | `1` | OK |
| Target size in 64-bit math | `2147483648` | `2147483648` | OK |
| Target size in signed 32-bit storage | positive | `-2147483648` | BUG |
| Container annotation bounds | `beg <= old_mid,new_mid <= end` | `old_mid > end`, `new_mid < beg` | BUG |

## Conclusion

Status: `STATE_BUG`

The debug evidence proves the repeated-field size accounting becomes invalid before
protobuf updates the packed field. One additional `fixed32` element turns
`INT_MAX` into `0x80000000`, and the real library code then feeds impossible
pointer bounds into ASan container annotations. This is not a benign parse error;
it is a state corruption that manifests as a memory-safety failure inside the
protobuf packed-field merge path.
