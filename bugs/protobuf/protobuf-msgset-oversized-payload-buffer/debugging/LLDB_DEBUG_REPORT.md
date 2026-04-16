# Debug Report: MessageSet Oversized Payload Buffer

## Executive Summary

Independent validation confirmed the core bug with a printf fallback after LLDB launch was blocked by macOS debugger permissions. The MessageSet parser reaches the `kMessageSetMessageTag` path with only 6 bytes remaining, derives a `message_data.resize(size)` target of 2147483637 bytes from the attacker-controlled length field, and attempts a 2147483640-byte allocation before any `ReadRaw()` availability check.

This is a real state bug and denial-of-service vector. The original example value near `0xffffffff` does **not** reach the resize path because `static_cast<int32_t>(length) < 0` rejects it first. A positive attacker-controlled value such as `0x7ffffff0` does reach the vulnerable branch and demonstrates the issue.

## Environment

- OS: macOS
- Arch: arm64
- Rosetta: no (`sysctl -n sysctl.proc_translated` returned empty / not `1`)
- Build directory: `builds/protobuf-asan-arm64`
- Validation method: printf fallback

## Attempts

1. LLDB on `poc_real` with a breakpoint at `wire_format_lite.h:1687`
   Result: breakpoint resolved inside the inlined `ParseMessageSetItemImpl`, but launch-time debugging failed. `DevToolsSecurity -status` reported `Failed to get right definition for: system.privilege.taskport.debug`.
2. Instrumented standalone fallback binary in `debugging/`
   Result: unstable in this environment.
3. Instrumented inline PoC in `poc/poc_real.cpp`
   Result: successful state capture.

## Source Path Under Test

From [`wire_format_lite.h`](/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/protobuf/src/google/protobuf/wire_format_lite.h#L1686):

- `ReadVarint32(&length)`
- signedness guard on `static_cast<int32_t>(length) < 0`
- `size = length + VarintSize32(length)`
- `message_data.resize(size)`
- only then `ReadRaw(ptr, length)`

The validated trigger used `length = 0x7ffffff0`, which stays positive as `int32_t` and therefore reaches `resize()`.

## Runtime Evidence

Working command:

```bash
cd /Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/bugs/protobuf/protobuf-msgset-oversized-payload-buffer/poc
env DYLD_LIBRARY_PATH=/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/builds/protobuf-asan-arm64/lib ./poc_real
```

Observed output:

```text
Applied memory limit=0
Using inline ParseMessageSetItemImpl from staged protobuf headers
Wire size=7 bytes
Claimed message bytes=2147483632
Varint size=5
Computed resize argument=2147483637
Wire hex=0b 1a f0 ff ff ff 07
Initial tag=11
CurrentPosition after start tag=1
BytesUntilLimit before parse=6
BytesUntilTotalBytesLimit before parse=-1
[marker] before ParseMessageSetItemImpl
Caught std::bad_alloc while parsing: std::bad_alloc
Largest attempted allocation=2147483640
Confirmed oversized allocation attempt before input availability validation
```

## Interpretation

- The parser has only 6 unread bytes after consuming the MessageSet start tag.
- The attacker-controlled varint decodes to 2147483632.
- The branch computes `size = length + VarintSize32(length) = 2147483637`.
- The instrumented allocation guard recorded an actual allocation attempt of 2147483640 bytes, which is consistent with string storage overhead/null termination around the requested resize size.
- The allocation attempt happens before any `ReadRaw(ptr, length)` check can reject the truncated input.

## Conclusion

Verdict: `STATE_BUG`

The bug exists for large positive `length` values that pass the signedness guard. The parser allocates an attacker-chosen multi-gigabyte temporary buffer before validating payload availability. The specific trigger value "near `0xffffffff`" is overstated, but the underlying denial-of-service condition is confirmed.
