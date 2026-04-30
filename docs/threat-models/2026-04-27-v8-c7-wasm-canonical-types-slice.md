# V8 C7 Slice - Wasm Canonical Types

Date: 2026-04-27
Target: V8 14.8.178.9
Surface: S4 WebAssembly canonical types

## Threat Contract

Wasm recursive groups and GC/reference types rely on canonical type IDs for cross-module equality, subtyping, and import/link checks. A false canonical merge can become type confusion. A false split can break valid programs. Invalid recursive supertype chains must be rejected before canonical supertypes are installed.

Source anchors:
- `src/wasm/canonical-types.cc:27-140`: recursive group registration.
- `src/wasm/canonical-types.cc:414-497`: type definition canonicalization.
- `src/wasm/canonical-types.h:240-395`: recursive group hashing/equality.
- `src/wasm/module-decoder-impl.h:846-868`: descriptor/describes validation.
- `src/wasm/constant-expression-interface.cc:207-209`: shared descriptor allocation abort in constant expressions.
- `src/wasm/struct-types.h:88-91`: shared custom descriptor layout unimplemented.

## Probes Run

Artifacts: `bugs/v8/c7-wasm-canonical-types/`

- H1 equivalent recursive group link: refuted.
- H2 non-isomorphic recursive group reject: refuted.
- H3 nullable vs non-nullable import reject: refuted.
- H4 self-supertype reject: refuted.
- H5 mutual-supertype reject: refuted.
- H6 equivalent descriptor recursive group link: refuted.
- H7 descriptor vs plain struct reject: refuted.
- H8 shared custom descriptor allocation in global init: confirmed release crash behind experimental flags.
- H9 shared custom descriptor allocation in function body: confirmed release crash behind experimental flags.

## Current Verdict

`CONFIRMED-CRASH-EXPERIMENTAL`

No canonical type false-merge has been found. The confirmed issue is that shared custom descriptor types validate under `--experimental-wasm-custom-descriptors --experimental-wasm-shared`, but allocation reaches `UNIMPLEMENTED()` in both constant-expression and runtime paths. This is likely below Chrome VRP memory-safety threshold today because the feature is experimental, but it is reportable upstream as a V8 correctness/DoS bug and should be tracked if the feature approaches default exposure.
