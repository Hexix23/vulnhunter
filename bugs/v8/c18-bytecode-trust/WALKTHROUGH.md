# C18 Bytecode Trust Walkthrough

## Goal

Check whether the bytecode verifier fully protects the interpreter/sandbox trust boundary, not only jump CFI.

Impact class:

- sandbox invariant
- interpreter trusted-state misuse
- memory safety if an unchecked operand reaches trusted object indexing
- DoS if only internal trap is reachable

Reachability:

- Current PoCs use d8 test intrinsics `%GetBytecode()` and `%InstallBytecode()`.
- This is enough for sink discovery, not enough for direct Chrome VRP.

Oracle:

- release vs ASAN/dcheck output
- Linux `--sandbox-testing` for boundary classification
- checked operand negative control

## Code path

`BytecodeVerifier::Verify()` runs:

```text
VerifyFull or VerifyLight
MarkVerified
```

`VerifyFull()` performs strong checks for:

- register operands and register ranges
- constant-pool indexes
- runtime function IDs
- abort reasons
- final instruction termination
- jump/switch/handler-table CFI via `VerifyLight()`

But these operand classes are accepted without validation:

```text
kFlag8
kFlag16
kEmbeddedFeedback
kIntrinsicId
kNativeContextIndex
kUImm
kImm
kFeedbackSlot
kContextSlot
kCoverageSlot
kRegCount
```

The first executable probe focused on `kContextSlot` because closure bytecode gives a tiny stable byte sequence:

```text
LdaImmutableCurrentContextSlot [2]
ThrowReferenceErrorIfHole [0]
Return
```

Changing slot `2` to `255` is accepted by `VerifyFull()`.

## PoCs

### H1 context read

`poc/h1-context-slot-read-oob.js`

The closure returns captured `x`. The bytecode operand for `LdaImmutableCurrentContextSlot` is changed from `2` to `255`.

Result:

- install succeeds
- execution traps at Torque unreachable
- Linux sandbox-testing reports harmless `SIGTRAP`, not sandbox violation

### H2 context write

`poc/h2-context-slot-write-oob.js`

The outer function initializes and writes a closure context slot. Both `StaCurrentContextSlotNoCell [2]` operands are changed to `255`.

Result:

- install succeeds
- execution traps at Torque unreachable
- Linux sandbox-testing reports harmless `SIGTRAP`, not sandbox violation

### H3 feedback slot, named load

`poc/h3-feedback-slot-oob.js`

The named-load feedback slot is changed to `255`.

Result:

- install succeeds
- simple object load returns correct value
- no crash or divergence in this shape

This does not clear feedback slots globally. It only says the first named-load shape is low signal.

### H4 constant-pool control

`poc/h4-constant-pool-oob-control.js`

The constant-pool index is changed to `255`.

Result:

- `VerifyFull()` rejects it before install
- fatal text: `Bytecode verification failed: Constant pool index out of bounds`

This proves the harness is hitting the intended verifier.

### H5 native context index

`poc/h5-native-context-index-oob.js`

Direct eval with spread generates `CallJSRuntime [reflect_apply]`. The native context index is changed to `255`.

Result:

- install succeeds
- execution exits through JS-visible `Error: 3+4`
- no crash or sandbox violation

This keeps `kNativeContextIndex` open, but this first shape is not high impact.

### H6 call feedback slot

`poc/h6-call-feedback-slot-oob-warm.js`

The function `o.m(x, 1)` is warmed to allocate feedback, then `CallProperty2` feedback slot is changed from `2` to `255`.

Result:

- install succeeds
- release mac crashes with `BUS_ADRALN`
- interpreter-only release still crashes, so this is not just Maglev/TurboFan
- ASAN/dcheck fails `IsOffsetInBounds(offset, LoadFeedbackVectorLength(feedback_vector), FeedbackVector::kHeaderSize)`
- Linux sandbox-testing release reports `Caught harmless memory access violation (safe region)`

This is the best C18 sink so far: malformed verified bytecode causes feedback-vector OOB access.

### H7 arithmetic feedback slot

`poc/h7-addsmi-feedback-slot-oob-warm.js`

`AddSmi [1], FBV[0]` is changed to `FBV[255]`.

Result:

- release execution returns the correct value
- ASAN/dcheck later hits a Maglev feedback metadata DCHECK

This is lower signal than H6.

### H8/H9 store feedback slots

`poc/h8-named-store-feedback-slot-oob-warm.js`

`poc/h9-keyed-store-feedback-slot-oob-warm.js`

Named and keyed stores are warmed, then their store feedback slot is changed to `255`.

Result:

- install succeeds
- release interpreter-only crashes with `BUS_ADRALN`
- ASAN/dcheck routes through `Runtime_StoreIC_Miss` / `Runtime_KeyedStoreIC_Miss`
- Linux sandbox-testing release reports safe-region memory access

These are important because they are write-side feedback consumers.

### H10 construct feedback slot

`poc/h10-construct-feedback-slot-oob-warm.js`

Construct feedback slot is changed from `2` to `255`.

Result:

- release returns the expected constructed object value
- ASAN/dcheck hits `IsOffsetInBounds` in the construct IC path

Lower signal than H6/H8/H9 for release, but it confirms verifier coverage gap across construct feedback too.

### H11/H12 load feedback slots

`poc/h11-named-load-feedback-slot-oob-warm.js`

`poc/h12-keyed-load-feedback-slot-oob-warm.js`

Named and keyed loads are warmed, then their feedback slot is changed to `255`.

Result:

- install succeeds
- release interpreter-only crashes with `BUS_ADRALN`
- default/light verification also accepts the bytecode
- ASAN/dcheck routes through `Runtime_LoadIC_Miss` / `Runtime_KeyedLoadIC_Miss`
- Linux sandbox-testing release reports safe-region memory access

These confirm both read-side and write-side IC consumers are affected.

### H13/H17 global load feedback slot

`poc/h13-global-load-feedback-slot-oob-warm.js`

`poc/h17-global-load-feedback-slot-object-exposure.js`

Global load is warmed, then `LdaGlobal` feedback slot is changed to `255`.

H13 with direct `print(f())` crashes. H17 avoids direct value printing and shows deterministic wrong value:

```text
baseline 13
...
typeof number
eq-undefined false
7
```

Linux sandbox-testing also returns Smi `7` without crash.

Source read:

- `LoadGlobalIC_TryPropertyCellCase()` loads `LoadFeedbackVectorSlot(vector, slot)`.
- If the OOB value is Smi, it is decoded as lexical-variable metadata and used to load a context slot.

This is the first C18 result that is not merely DoS: it is visible wrong-code / execution-integrity divergence under malformed verified bytecode.

### H18 global load slot matrix

`poc/h18-global-load-feedback-slot-matrix.js`

This parameterized probe maps `LdaGlobal FBV[n]`.

Useful results:

- `slot=1`: returns `undefined`.
- `slot=4`: stores `ScopeInfo FUNCTION_SCOPE` in JS local `r`, then aborts on `typeof`.
- `slot=5` and `slot=255`: store `ScopeInfo SCRIPT_SCOPE`.
- `slot=6..32`: return string `"undefined"`.
- `slot=63`: returns numeric wrong value `632448`.
- `slot=128`: returns string-like `[weak cleared]`.

Linux sandbox-testing with `slot=4` also shows:

```text
var r = <ScopeInfo FUNCTION_SCOPE>
EXIT:0
```

This is the best direction now: global-load OOB can move internal objects into JS frame state before the engine aborts.

### H19/H20 storing the internal value

`poc/h19-global-load-scopeinfo-store-gc.js`

`poc/h20-global-load-scopeinfo-stored-debugprint.js`

H19 takes the value returned by `LdaGlobal FBV[4]`, stores it into an object property and array element, forces GC twice, and reloads both fields.

Release, ASAN, and Linux sandbox-testing all complete:

```text
returned
stored
gc1-ok
loaded
gc2-ok
```

H20 then uses checking/debug paths. Release still completes. ASAN/dcheck aborts in `StoreIC::Store` with a failed `TrustedCast<JSAny>`.

Interpretation:

- release allows an internal `ScopeInfo`-class value to cross into normal JS containers;
- dcheck builds know this violates the JSAny boundary;
- GC does not immediately reject the state.

### H21-H25 consuming the stored internal value

`poc/h21-scopeinfo-property-read-equality.js`

`poc/h22-scopeinfo-json-string-conversion.js`

`poc/h23-scopeinfo-array-iteration-spread.js`

`poc/h24-scopeinfo-optimized-caller.js`

`poc/h25-scopeinfo-gc-stress-many-containers.js`

H21 checks whether normal property reads and strict equality preserve the poisoned identity:

```text
same_field true
same_arr true
cross_same true
```

H23 checks array iteration, spread, and `includes()`:

```text
iter-count 1
spread-len 1
includes true
```

H24 warms/optimizes a caller that forwards the poisoned container. Release completes.

H22 feeds the poisoned container into JSON:

```text
Check failed: IsJSReceiver(*object).
JsonStringifier::Serialize_
```

H25 repeats poisoned global-load results into many containers under GC/IC stress:

```text
unreachable code
FeedbackNexus::GetFirstMap()
Runtime_LoadGlobalIC_Miss
```

ASAN/dcheck for H22/H25 aborts earlier at `StoreIC::Store` with `TrustedCast<JSAny>`, confirming the same invariant breach seen in H20.

Interpretation:

- poisoned internal value can move through several ordinary JS paths;
- some consumers tolerate it, which helps chaining;
- JSON and IC stress hit release fatal checks;
- Linux sandbox-testing still classifies both fatal paths as harmless, not sandbox escape.

### H26-H36 propagation and consumer map

H26-H29 classify normal object/collection paths:

- `Object.assign` and object spread preserve the poisoned value.
- `Object.keys` / `Object.values` / `Object.entries` / descriptors complete.
- `Map` value storage and `Set` membership complete.
- `WeakMap` key use gives normal `TypeError`.
- delete, overwrite, freeze, and seal complete.

H30-H36 classify array/coercion consumers:

- `Array.prototype.map`, `filter`, and `slice` can move the poisoned value.
- `Array.prototype.join` fatals in release.
- `typeof` fatals in release with `Unexpected instance type encountered`.
- `String()` fatals in release.
- `Object.prototype.toString.call()` returns `[object Object]`.
- `Boolean()` returns `true`.

ASAN/dcheck confirms these are not just arbitrary crashes: H32 hits a Torque array cast assert, while H33/H34 hit the same `TrustedCast<JSAny>` family as H20/H22/H25.

`--verify-bytecode-full` does not stop H32; the bad `FeedbackSlot` is still accepted before `Array.join` fatals.

### H37-H38 valid bytecode plus FeedbackVector corruption

H37 and H38 stop mutating `BytecodeArray`.

Instead:

1. compile normal `function f() { return C18_GLOBAL; }`;
2. allocate normal feedback vector with `%EnsureFeedbackVectorForFunction(f)`;
3. use sandbox memory-corruption API to copy `FeedbackVector` slot 4 into slot 0;
4. execute unchanged `LdaGlobal FBV[0]`.

H37 result:

```text
baseline=13
slot0=...
slot4=...
returned
same-global false
Check failed: IsPropertyCell(*feedback_value).
```

H37 dcheck also logs `TrustedCast<JSAny>`.

H38 then feeds the poisoned result into `Array.join`. Release sandbox still dies on `IsPropertyCell`; dcheck dies on the Torque array cast used by join.

Interpretation:

- C18 is not only a malformed-bytecode sink.
- Under the V8 sandbox corruption model, valid bytecode plus corrupted `FeedbackVector` state reaches the same bad value-flow.
- Still no sandbox escape: Linux sandbox-testing safely terminates both release and dcheck.

H39 maps the valid-bytecode variant across source slots:

- src 4: object/internal-looking wrong value.
- src 6-8, 10, 14-16, 31: string wrong value.
- src 2-3: inside-sandbox memory access.
- many wrong-value cases later hit `Check failed: IsPropertyCell(*feedback_value)`.

So the `FeedbackVector` poisoning path is a family, not a single lucky slot.

### H40-H45 valid PropertyCell aliasing and metadata mismatch

H40 copies a valid global-load `PropertyCell` from `g(){return B}` into the valid feedback slot of `f(){return A}`. No malformed bytecode, no invalid object:

```text
before f=13 g=99
after f=99 g=99
f_is_B true
```

H42 proves this is a live alias to `B`'s property cell:

```text
after-A-write f=99 A=44 B=99
after-B-write f=1234 A=44 B=1234
reads_B true
```

H43 optimizes a caller after corruption:

```text
optimized caller=100 f=99
after-B-write caller=124 f=123
```

Dcheck does not complain for H40/H42/H43.

H44 tried the same idea on global stores across a 9x9 slot matrix. No write redirection observed; `setA(777)` still updates `A`, not `B`.

H45 corrupts `FeedbackVector.shared_function_info` to a function with different metadata. Compiler/broker checks catch this mismatch:

```text
Check failed: function.shared(broker).equals(feedback_cell.shared_function_info(broker).value()).
```

Interpretation:

- Best C18 primitive is now valid-bytecode, valid-object, clean wrong-global read.
- This is stronger than internal `ScopeInfo` fatal consumers because it is stable and dcheck-clean.
- It is still sandbox-corruption-model only, not natural web reachability.

H46/H47 repeat the `PropertyCell` alias across d8 realms:

```text
after-corrupt f=99 g=99
after-writes f=1234 A=44 g=1234
reads_cross_realm_B true
```

This works both with `Realm.createAllowCrossRealmAccess()` and plain `Realm.create()`, and dcheck remains clean.

## Reachability audit

Current source read:

- Normal compiler path: `BytecodeArrayWriter::ToBytecodeArray()` creates a `BytecodeArray` and calls `BytecodeVerifier::Verify()`.
- `%InstallBytecode()` path: creates attacker-mutated bytecode, verifies it, then installs it. This is the current artificial harness.
- Debug bytecode path: `InstallDebugBytecode()` copies a normal bytecode array and activates the copy. Side-effect checks call `ApplyDebugBreak()`, which only changes the opcode to the matching `DebugBreak*` bytecode and leaves operands intact.
- Code serializer temporarily swaps active debug/original bytecode arrays but does not synthesize bytecode operands.
- `UpdateEmbeddedFeedback()` writes into verified bytecode at runtime, but only ORs bounded binary/compare feedback bits into embedded-feedback operands.

Conclusion: no natural shipped path found yet that writes arbitrary `FeedbackSlot` operands. C18 remains a strong sink and post-corruption impact multiplier, but not standalone VRP until reachability is solved.

### H14-H16 lower signal

Global store, `Inc`, and compare `EmbeddedFeedback` were accepted by the verifier but did not produce release-visible impact in the first shapes.

## Interpretation

This is a real sink, but not a finished report.

Strong signal:

- full verifier accepts invalid `ContextSlot`, `NativeContextIndex`, and `FeedbackSlot`
- malformed bytecode is published/installed
- both read and write bytecodes reach internal trap on execution
- H6/H8/H9 reach real feedback-vector consumers and release safe-region crashes
- H11/H12 show load-side ICs are also affected
- H17 shows global load can return a wrong JS-visible value
- H18 shows global load can expose `ScopeInfo` into JS locals
- H19/H20 show the value can be stored in JS containers and survive GC
- H21/H23/H24 show property/equality/array/optimized-caller propagation survives
- H22/H25 show later consumers can hit release fatal checks
- H26-H36 map which JS consumers propagate vs fatal-consume the poisoned value
- H37-H39 remove bytecode mutation and prove a valid-bytecode `FeedbackVector` corruption family
- H40-H43 produce clean dcheck-safe wrong-global read via valid `PropertyCell` aliasing
- H44/H45 refute first store-redirection and metadata-mismatch escalation shapes
- H46/H47 show the read alias can cross realm/context boundaries in d8
- checked operand control rejects as expected

Weakness:

- malformed-bytecode path is d8-internal
- valid-bytecode path still requires sandbox memory-corruption API
- natural shipped mutation path for arbitrary `FeedbackSlot` or vector slot poisoning not found yet
- observed crash is trap/DoS, not controlled memory corruption
- sandbox-testing says harmless signal

## Why this matters for the larger hunt

The previous work over-focused on “sandbox escape or nothing”. C18 shows a better method:

1. audit sinks first;
2. prove the verifier/sanitizer accepts a bad state;
3. classify the immediate consequence honestly;
4. chain only after sink proof.

This surface remains useful because bytecode is an interpreter trust object. If another primitive can corrupt verified bytecode operands, unchecked operand classes become post-corruption impact multipliers.

## Next hypotheses

H5: handler-table mutation plus valid CFI to redirect exception handlers into bytecode using bad operands.

H6: `kNativeContextIndex` on bytecodes that read from native context arrays.

H7: `kCoverageSlot` on coverage-enabled builds/flags.

H8: extend feedback-slot OOB to remaining consumers: define-keyed-own, for-in, create-literal, private member, `ToName`, and call variants with different IC states.

H11: try to turn H17 wrong-value into object/reference exposure by shaping the OOB feedback-vector memory adjacent to a weak/property-cell entry instead of Smi lexical metadata.

H12: with H18 `ScopeInfo` exposure, test operations that store/forward the value without immediate `typeof` or `print`, e.g. object property assignment, array element storage, return through caller, GC marking, and optimized compilation of the caller.

H13: continue from H19-H36 into stronger impact: shape the poisoned value into something other than `ScopeInfo`, run optimized/tiered consumers with Maglev/TurboFan explicitly enabled, test structured clone / promise / proxy / typed-array boundary consumers, and solve natural reachability outside `%InstallBytecode()`.

H9: `kUImm` / `kImm` on bytecodes where immediates become array indexes or argument counts.

H10: post-`MarkVerified()` bytecode mutation through sandbox memory corruption API to check if Linux sandbox-testing reports an actual out-of-sandbox violation.
