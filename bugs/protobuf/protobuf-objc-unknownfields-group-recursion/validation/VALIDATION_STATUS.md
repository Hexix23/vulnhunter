# VALIDATION_STATUS.md

## Finding: protobuf-objc-unknownfields-group-recursion

**Status:** NEEDS_DIFFERENT_BUILD

**Validated Against:**
- Requested build: `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/builds/protobuf-asan-arm64`
- Observed platform: Darwin arm64
- Date: 2026-04-15T22:57:36Z

**What was checked:**
- Confirmed the bug directory had no existing PoC to reuse.
- Confirmed `/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/builds/protobuf-asan-arm64/compile_flags.txt` and `link_flags.txt` exist.
- Enumerated the installed headers and libraries under that build.
- Reviewed the vulnerable implementation in `targets/protobuf/objectivec/GPBUnknownFields.m`.
- Reviewed the Objective-C packaging/build metadata in:
  - `targets/protobuf/Protobuf.podspec`
  - `targets/protobuf/objectivec/README.md`
  - `targets/protobuf/objectivec/BUILD.bazel`
  - `targets/protobuf/objectivec/ProtocolBuffers_OSX.xcodeproj/project.pbxproj`

**Evidence:**
- The current build exports C++ runtime artifacts such as `libprotobufd.a`, `libprotobuf-lited.a`, and `libupbd.a`.
- The current build does not export the Objective-C runtime library or headers needed for `GPBUnknownFields`, such as `libProtocolBuffers.a` and the `GPB*.h/.m` runtime surface.
- The finding is in Objective-C runtime code at `targets/protobuf/objectivec/GPBUnknownFields.m:161`, specifically in recursive descent from `MergeFromInputStream()`.
- The repo’s Objective-C build metadata identifies the missing deliverable:
  - Bazel target: `//objectivec:objectivec`
  - Xcode target/product: `ProtocolBuffers` producing `libProtocolBuffers.a`
  - Runtime umbrella source: `targets/protobuf/objectivec/GPBProtocolBuffers.m`

**Why this could not be validated against the current build:**
- The provided ASan build is for the C++ protobuf runtime, not the Objective-C runtime.
- Linking a PoC against the current libraries would not execute `GPBUnknownFields` from the real compiled product because that code is absent from the staged artifacts.
- Compiling Objective-C sources directly would violate the validator rule requiring validation against the pre-built compiled library.

**Requested next build:**
```json
{
  "finding_id": "protobuf-objc-unknownfields-group-recursion",
  "status": "NEEDS_DIFFERENT_BUILD",
  "reason": "Bug is in the Objective-C runtime, not the packaged C++ protobuf ASan libraries",
  "build_request": {
    "target_library": "libProtocolBuffers.a",
    "target_name": "ProtocolBuffers",
    "source_file": "targets/protobuf/objectivec/GPBProtocolBuffers.m",
    "alternative_target": "//objectivec:objectivec",
    "build_hint": "Build the Objective-C runtime with ASan and stage it as builds/protobuf-objc-asan-arm64/ with compile_flags.txt, link_flags.txt, headers, and libProtocolBuffers.a",
    "why": "GPBUnknownFields and initFromMessage: are only present in the Objective-C runtime."
  }
}
```

**Conclusion:**
The source finding appears credible, but it is **not confirmed** because the available pre-built ASan artifact does not contain the vulnerable Objective-C runtime. A dedicated Objective-C ASan build is required before a real-library PoC can be compiled and executed.
