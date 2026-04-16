# LLDB Debug Report: protobuf-objc-unknownfields-group-recursion

## Status

INCONCLUSIVE: runtime state capture could not be performed against a pre-built Objective-C runtime artifact because the provided build tree does not contain `GPBUnknownFields`.

## Environment

- OS: Darwin
- Arch: arm64
- Rosetta: not detected (`sysctl.proc_translated` returned empty/false)
- Requested build: `builds/protobuf-asan-arm64`

## What Was Checked

1. Verified the supplied staged build contents under `builds/protobuf-asan-arm64`.
2. Searched alternative local protobuf build trees for an Objective-C `ProtocolBuffers` product.
3. Reviewed the vulnerable source and the Objective-C coded-input recursion guard implementation to confirm the intended runtime observation points.

## Artifact Evidence

The supplied staged build only contains C++/upb products such as:

- `libprotobufd.a`
- `libprotobuf-lited.a`
- `libupbd.a`

It does not contain any Objective-C runtime product such as:

- `libProtocolBuffers.a`
- Objective-C staged headers/build flags for `GPBUnknownFields`

Additional local protobuf build trees under `targets/protobuf/build-*` also lacked a `ProtocolBuffers` Objective-C library artifact.

## Source Evidence Defining the Expected Bug

### Vulnerable recursion path

`targets/protobuf/objectivec/GPBUnknownFields.m:100-175` recursively descends into nested unknown groups:

- At line 106, it operates directly on `GPBCodedInputStreamState *state = &input->state_;`
- At line 154, it handles `GPBWireFormatStartGroup`
- At line 161, it recursively calls `MergeFromInputStream(group, input, endGroupTag)`

There is no call to `CheckRecursionLimit(state)` and no increment/decrement of `state->recursionDepth` in this helper.

### Normal guarded paths

`targets/protobuf/objectivec/GPBCodedInputStream.m` shows the expected protection elsewhere:

- `CheckRecursionLimit()` is defined at lines 53-56.
- `SkipToEndGroupInternal()` calls `CheckRecursionLimit(state)` and increments `recursionDepth` at lines 290-297.
- `-readGroup:` calls `CheckRecursionLimit(&state_)` and increments/decrements depth at lines 506-514.
- `-readMessage:` and `-readMapEntry:` do the same at lines 517-542.

## Why LLDB Was Not Run

This validator must use a pre-built target library rather than rebuilding the Objective-C runtime manually. The only supplied staged build is for the C++ protobuf runtime, and linking a PoC against it would not execute `GPBUnknownFields` from a compiled Objective-C product.

Without a pre-built Objective-C runtime artifact, any LLDB session would either:

- fail to link a real PoC, or
- validate a locally rebuilt binary, which violates the stated validation constraint.

## Required Build For Runtime Validation

Stage an Objective-C runtime build such as:

`builds/protobuf-objc-asan-arm64/`

with at least:

- `compile_flags.txt`
- `compile_flags_debug.txt`
- `link_flags.txt`
- `link_flags_debug.txt`
- `lib/libProtocolBuffers.a` or equivalent
- exported Objective-C headers for `GPBProtocolBuffers`

## Final Verdict

The finding is source-credible and the missing recursion guard is clear in the Objective-C implementation, but this pass is **INCONCLUSIVE** because no permitted pre-built Objective-C runtime artifact exists for LLDB or printf-based runtime state capture.
