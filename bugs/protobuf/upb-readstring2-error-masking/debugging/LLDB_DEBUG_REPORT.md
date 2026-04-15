# LLDB Debug Report: upb-readstring2-error-masking

## Build Information

- Build directory: `builds/protobuf-asan-arm64`
- Debug binary: `bugs/protobuf/upb-readstring2-error-masking/debugging/poc_debug`
- State harness: `bugs/protobuf/upb-readstring2-error-masking/debugging/poc_state`
- Source references:
  - `_upb_Decoder_ReadString2()` at `targets/protobuf/upb/wire/decode.c:181-187`
  - `_upb_Decoder_ReadString()` at `targets/protobuf/upb/wire/internal/decoder.h:195-214`
  - `upb_EpsCopyInputStream_ReadStringAlwaysAlias()` at `targets/protobuf/upb/wire/internal/eps_copy_input_stream.h:238-257`
  - `upb_EpsCopyInputStream_ReturnError()` at `targets/protobuf/upb/wire/eps_copy_input_stream.c:19-24`

## Executive Summary

`lldb` could not be used on this host because `debugserver` is missing. Per the required fallback chain, I retried with codesigning and explicit `--arch arm64`, confirmed `gdb` is not installed, then captured the equivalent runtime state with a small debug harness linked against the pre-built `libupb.a`.

The captured state shows the finding does **not** reproduce in the real library:

- The malformed field declares a 5-byte string but only 1 payload byte exists.
- The low-level string read fails immediately: `read_ret=NULL`, `stream.error=1`.
- In the real decoder path, `_upb_Decoder_ReadString()` does **not** return `false` to `_upb_Decoder_ReadString2()`; it longjmps first with error code `2` (`Malformed`).
- The public `upb_Decode()` result is also `2` (`Wire format was corrupt`).

That means the suspected `_upb_Decoder_ReadString2() -> OutOfMemory` masking branch is not taken for this truncated-string testcase.

## Debugger Attempts

### Attempt 1: LLDB batch

`lldb -b -s debugging/lldb_commands.txt debugging/poc_debug`

Result:

```text
error: could not find 'debugserver'. Please ensure it is properly installed and available in your PATH
```

### Attempt 2: Codesigned binary + explicit arch

`codesign -s - -f debugging/poc_debug`

`lldb --arch arm64 -b -s debugging/lldb_commands.txt debugging/poc_debug`

Result:

```text
error: could not find 'debugserver'. Please ensure it is properly installed and available in your PATH
```

### Attempt 3: GDB fallback

Result:

```text
gdb-not-installed
```

### Attempt 4: Printf/state-capture fallback

The fallback harness was compiled against the pre-built `libupb.a` and executed successfully.

## Step-by-Step Evidence

### 1. Low-level stream state before the decoder wrapper

Input bytes:

```text
0a 05 41
```

Meaning:

- `0a`: field 1, length-delimited
- `05`: declared string length is 5
- `41`: only one payload byte is actually present

Captured output:

```text
[low-level] initial ptr_offset=0 limit=0 error=0
[low-level] input bytes: 0a 05 41
[low-level] tag=0xa field=1 wire_type=2 declared_size=5 payload_offset=2
[low-level] read_ret=0x0 required_end_offset=7 available_payload=1
[low-level] stream.error=1 view.size=0
```

Interpretation:

- Payload starts at offset `2`.
- The decoder needs bytes through offset `7`.
- Only `1` payload byte is available.
- `upb_EpsCopyInputStream_ReadStringAlwaysAlias()` returns `NULL` and sets `stream.error=1`.

This matches the implementation in `eps_copy_input_stream.h:249-253` and `eps_copy_input_stream.c:19-24`.

### 2. Real decoder error code at `_upb_Decoder_ReadString()`

Captured output:

```text
[decoder] before _upb_Decoder_ReadString: err.code=0 size=5 ptr_offset=2 limit=0
[decoder] longjmp err.code=2 (Wire format was corrupt)
```

Interpretation:

- The decoder enters the string-read helper with a clean error state: `err.code=0`.
- The requested size is still `5`, with the payload pointer at offset `2`.
- The helper does **not** return `false` for `_upb_Decoder_ReadString2()` to remap.
- Instead, the stream-level error handler throws `Malformed` immediately (`err.code=2`).

This is the decisive state transition: the candidate masking branch in `decode.c:184-185` is bypassed because control never returns there for this input.

### 3. Public decode result

Captured output:

```text
[public] upb_Decode status=2 (Wire format was corrupt)
```

Interpretation:

- End-to-end behavior matches the internal state capture.
- The compiled library reports `Malformed`, not `OutOfMemory`.

## Summary Table

| Check | Expected for bug | Actual | Result |
|-------|------------------|--------|--------|
| Declared string size | 5 | 5 | OK |
| Available payload bytes | 1 | 1 | Truncated input confirmed |
| Low-level read result | return `false` to wrapper | `NULL` + `stream.error=1` | Wrapper remap path not reached |
| Decoder error code | `1` (`OutOfMemory`) | `2` (`Malformed`) | STATE_OK |
| Public decode status | `1` (`OutOfMemory`) | `2` (`Malformed`) | STATE_OK |

## Conclusion

No incorrect state was observed in the real library for this testcase. The malformed truncated string is detected at the stream layer and surfaced as `kUpb_DecodeStatus_Malformed` before `_upb_Decoder_ReadString2()` can convert the condition to `kUpb_DecodeStatus_OutOfMemory`.
