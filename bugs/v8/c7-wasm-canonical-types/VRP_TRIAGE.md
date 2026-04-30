# VRP Triage - C7 H8/H9

## Finding

Shared custom descriptor Wasm types are accepted when both feature gates are enabled, but allocation reaches `UNIMPLEMENTED()` and aborts the process in release.

Confirmed release crash:

```sh
/Users/carlosgomez/v8-engagement/v8/v8/out/release/d8 \
  --wasm-staging \
  --experimental-wasm-shared \
  bugs/v8/c7-wasm-canonical-types/poc/h9-minimal-raw.js
```

Exit: `133` / `Trace/BPT trap`.

## Minimal Flags

Required:

```text
--wasm-staging
--experimental-wasm-shared
```

Equivalent explicit form:

```text
--experimental-wasm-custom-descriptors
--experimental-wasm-shared
```

Not required:

```text
--allow-natives-syntax
--expose-gc
--wasm-staging
```

`--wasm-staging` is only needed as shorthand for custom descriptors.

## Negative Exposure Checks

Default release:

```sh
d8 bugs/v8/c7-wasm-canonical-types/poc/h9-minimal-raw.js
```

Result:

```text
CompileError: WebAssembly.Module(): unknown type form: 101, enable with --experimental-wasm-shared
```

`--wasm-staging` only:

```sh
d8 --wasm-staging bugs/v8/c7-wasm-canonical-types/poc/h9-minimal-raw.js
```

Result:

```text
CompileError: WebAssembly.Module(): unknown type form: 101, enable with --experimental-wasm-shared
```

`--experimental-wasm-shared` only:

```sh
d8 --experimental-wasm-shared bugs/v8/c7-wasm-canonical-types/poc/h9-minimal-raw.js
```

Result:

```text
CompileError: WebAssembly.Module(): descriptor types need --experimental-wasm-custom-descriptors
```

## Eligibility Assessment

Chrome VRP FAQ says unlaunched/flagged code may still be interesting, but explicitly excludes V8 security bugs specific to `--experimental` configurations from reward eligibility.

This finding currently requires `--experimental-wasm-shared`. Therefore:

- Chrome VRP rewardability: unlikely / currently no.
- Upstream V8 bug reportability: yes.
- Security severity: likely DoS / process abort / `Security_Impact-None` if triaged under flagged experimental code.

## Non-Experimental Expansion

Additional default-release probes were added to look for a shipped Wasm GC variant of the same canonical-type class:

- H10 final vs non-final struct identity: refuted.
- H11 struct field mutability identity: refuted.
- H12 packed field width identity: refuted.
- H13 array mutability identity: refuted.
- H14/H15 exact indexed refs: not default-release; gated by `--experimental-wasm-custom-descriptors`.
- H16 mutable struct field covariance rejection: refuted.
- H17 immutable struct field covariance positive control: OK.
- H18 mutable array element covariance rejection: refuted.
- H19 immutable array element covariance positive control: OK.
- H20 self-recursive singleton equivalence: OK.
- H21 singleton vs mutual-recursive false merge: refuted.
- H22 external-vs-internal recgroup edge false merge: refuted.

Current non-experimental C7 result: no default-release VRP primitive found.

## 2026-04-27 Gate Expansion Check

This follow-up rechecked whether H8/H9 can be moved out of the experimental
configuration.

Feature gate source audit:

- `src/wasm/wasm-feature-flags.h`: `shared` is listed under
  `FOREACH_WASM_EXPERIMENTAL_FEATURE_FLAG`, disabled by default.
- `src/wasm/wasm-feature-flags.h`: `custom_descriptors` is listed under
  `FOREACH_WASM_STAGING_FEATURE_FLAG`, disabled by default but enabled by
  `--wasm-staging`.
- `src/flags/flag-definitions.h:2081-2085`: experimental/pre-staging Wasm
  features use `DEFINE_EXPERIMENTAL_FEATURE`; staging/shipped features use a
  normal `DEFINE_BOOL`.
- `src/flags/flag-definitions.h:2117-2119`: `--wasm-staging` implies staged
  features only; it does not imply `experimental_wasm_shared`.
- `src/flags/flag-definitions.h:1802-1803`: `experimental_wasm_shared`
  implies shared heap/shared strings, confirming it is the separate gate.
- `src/wasm/wasm-features.cc:50`: Wasm origin-trial extension space is empty in
  this checkout.

Fresh release repro matrix:

```text
d8 h9-minimal-raw.js
=> CompileError: unknown type form: 101, enable with --experimental-wasm-shared

d8 --wasm-staging h9-minimal-raw.js
=> CompileError: unknown type form: 101, enable with --experimental-wasm-shared

d8 --experimental-wasm-shared h9-minimal-raw.js
=> CompileError: descriptor types need --experimental-wasm-custom-descriptors

d8 --wasm-staging --experimental-wasm-shared h9-minimal-raw.js
=> Fatal error: unimplemented code
```

Conclusion:

- H8/H9 are confirmed upstream V8 bugs: valid feature-gated Wasm reaches a
  process-fatal `UNIMPLEMENTED()` in release.
- H8/H9 are not direct Chrome VRP candidates in this state because the crash
  requires `--experimental-wasm-shared`.
- `custom_descriptors` alone is not the blocker for VRP eligibility; `shared`
  is the blocker.
- No local source path currently shows `experimental_wasm_shared` being enabled
  by `--wasm-staging`, default release, or a Wasm origin trial.

## Escalation Paths

To turn this into a stronger Chrome VRP candidate, one of these must be shown:

1. The crash is reachable without `--experimental-wasm-shared`.
2. Chrome exposes `experimental_wasm_shared` to web content through an origin trial, Finch/field trial, or stable channel flag configuration that is considered shipped to users.
3. The same root cause has a non-experimental path through shipped Wasm GC/custom descriptor support.
4. The crash can be transformed from fatal `UNIMPLEMENTED()` into memory corruption in a shipped configuration.

Current local testing supports none of those. The honest next step is upstream V8 report plus continued hunting for a non-experimental variant.

## Root Cause Summary

The validator permits shared descriptor/describes pairs under feature gates:

- `module-decoder-impl.h:846-861`: descriptor symmetry and same sharedness.
- `module-decoder-impl.h:863-868`: describes back-reference.

But implementation is missing later:

- `constant-expression-interface.cc:207-209`: shared descriptor constant-expression allocation aborts.
- `wasm-objects.cc:2190-2192`: runtime shared descriptor allocation aborts.
- `struct-types.h:88-91`: shared descriptor offset layout explicitly unimplemented.

The correct behavior should be either:

- reject shared custom descriptor allocation during validation until implemented; or
- implement shared descriptor layout/allocation.
