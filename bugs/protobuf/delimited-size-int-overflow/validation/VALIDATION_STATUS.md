# Validation Status

## Finding

`delimited-size-int-overflow`

## Status

`LOGIC_BUG`

## Validated Against

- Library build: `builds/protobuf-asan-arm64`
- Binary: `bugs/protobuf/delimited-size-int-overflow/poc/poc_real`
- Date: `2026-04-15`

## Compilation

Existing PoC binary was reused from the real-library build flow in
`bugs/protobuf/delimited-size-int-overflow/poc/build_real.sh`.

## Execution

Command:

```bash
ASAN_OPTIONS=detect_leaks=0 ./bugs/protobuf/delimited-size-int-overflow/poc/poc_real
```

Exit code: `2`

## Evidence

The run produced no AddressSanitizer crash. It did reproduce the incorrect
runtime behavior in the compiled protobuf library:

```text
size_u32=2147483648
narrowed_size_i32=-2147483648
bytes_until_limit_after_push=-1
skip_remaining_succeeded=true
final_position=13
evidence=overflowed size disables PushLimit enforcement in the real library
```

## Conclusion

The issue is validated as a real-library logic bug, not a confirmed memory
corruption bug. The oversized varint is narrowed to a negative `int`, which
causes `PushLimit()` to behave as if no limit is active.
