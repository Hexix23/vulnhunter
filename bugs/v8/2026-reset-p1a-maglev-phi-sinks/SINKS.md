# P1-A Maglev Phi Retagging Sink Enumeration

Date: 2026-04-28
Threat model: `docs/threat-models/2026-04-28-v8-2026-cve-threat-model-reset.md`

Goal: start fresh from 2026 CVE classes. This slice targets the Maglev
phi-retagging invariant behind the March 2026 fixes:

> A phi proven as HeapObject/Smi before representation selection must not be
> retagged into a different concrete representation without updating the
> dependent check, branch, or write barrier.

## Seed Fixes

| Commit | Fix signal | Local invariant |
|---|---|---|
| `4b81c6ebce9` | Missing Smi check in `ToBoolean(tagged phi)` | Retagged phi can become Smi; `ToBoolean` must use `CheckHeapObject`. |
| `c1e78b455e3` | Smi type widening in `BuildCheckHeapObject` | A phi whose initial type includes Smi can still become HeapNumber after `EnsureType`. |
| `248fc4caa25` | Unexpected Smi in `StoreTaggedFieldWithWriteBarrier` | Write barrier metadata must be based on actual post-retag value possibility. |

## Confirmed Covered Sinks

These are already explicitly patched or locally guarded in the current source.
They are useful as shape templates, not replay targets.

| Sink | File/line | Guard observed |
|---|---|---|
| `ToBoolean` / `ToBooleanLogicalNot` | `src/maglev/maglev-phi-representation-selector.cc:1396-1450` | Tagged phi case now forces `CheckType::kCheckHeapObject`. |
| `BuildCheckHeapObject` | `src/maglev/maglev-graph-builder.cc:4183-4209` | Calls `SetUseRequiresHeapObject()` and re-adds `HeapNumber` possibility when initial type can be Smi. |
| `StoreTaggedFieldWithWriteBarrier` | `src/maglev/maglev-phi-representation-selector.cc:1311-1331` and `src/maglev/maglev-graph-builder.cc:4783-4787` | Retagged value phi sets `value_can_be_smi=true`; builder computes via `GetCheckType(GetType(value), value)`. |
| `StoreTaggedFieldNoWriteBarrier` | `src/maglev/maglev-phi-representation-selector.cc:1269-1307` | Retagged value phi is upgraded to write-barrier store. |

## Neighbor Sinks To Probe

These share the same stale-type/check contract and are not yet validated in
this reset.

| ID | Sink | Why suspect | PoC shape |
|---|---|---|---|
| H1 | `CheckMaglevType` | It mutates expected type for int/float phis, but only considers `HeapNumber`/`Smi` widening. Need verify all object type checks that rely on this. | HeapNumber/string/object phi, force untagging, then property/call path requiring a specific type. |
| H2 | `BuildCheckString`, `BuildCheckSymbol`, `BuildCheckJSFunction`, `BuildCheckJSReceiver` | These all use `GetCheckType(known_type, object)`. Need verify `GetCheckType` records heap-object requirement for phi before retagging in all paths. | Phi enters string/symbol/function/receiver fast path after numeric use. |
| H3 | `BuildBranchIfToBooleanTrue` alternative path | It may branch through `node_info->alternative().int32/float64/holey_float64()` before the final `BranchIfToBooleanTrue`. Need test stale alternative after retagging. | Phi used numerically to create alternative, then truthiness branch with object/string arm. |
| H4 | `CanElideWriteBarrier` / allocation tracking | It can elide a barrier if a tagged alternative is Smi. Need verify non-escaping allocation + retagged phi cannot hide old-to-new reference. | Old object field store, phi numeric/object value, GC stress after store. |
| H5 | `CheckMaps` / map load consumers | Object map checks may treat non-tagged HeapNumber specially. Need verify phi retagging does not skip map check for non-HeapNumber object. | Phi numeric/object, access optimized map-dependent property/method. |
| H7 | FixedArray element store as stale-type producer | Confirmed diagnostic primitive: false arm canonicalizes to Smi while KNA expects `HeapNumber|OtherJSReceiver`. | Minimal `arr[0] = v`; assert-types catches stale type. |
| H8 | H7 -> field store | Tests whether stale type reaches `StoreTaggedFieldWithWriteBarrier`. | `arr[0]=v; holder.x=v`. |
| H9 | H7 -> ToBoolean / number-to-string siblings | Tests safe generic consumers after stale type. | Branch/string conversion after array store. |
| H10 | H7 -> `Reflect.getPrototypeOf` | Tests JSReceiver/heap object consumer after stale type. | `arr[0]=v; Reflect.getPrototypeOf(v)`. |
| H11 | H7 -> `instanceof` | Tests prototype-chain consumer after stale type. | `arr[0]=v; v instanceof C`. |

## Runtime Oracle

Use both:

```sh
bash /Users/carlosgomez/v8-engagement/scratch/repro.sh bugs/v8/2026-reset-p1a-maglev-phi-sinks/poc/hN.js
/Users/carlosgomez/v8-engagement/v8/v8/out/release/d8 --allow-natives-syntax --maglev --maglev-untagged-phis bugs/v8/2026-reset-p1a-maglev-phi-sinks/poc/hN.js
```

Harness caveat: `repro.sh case.js extra-flags` is currently unsafe for extra
flags because `asan-options.sh` may `exec "$@"` while sourced. For ASAN runs
needing extra flags, invoke `out/asan/d8` directly with `ASAN_OPTIONS` and
`ASAN_SYMBOLIZER_PATH`.

Signal:

- ASAN/dcheck crash.
- Release crash.
- Interpreter vs Maglev output divergence.
- Wrong deopt behavior only counts if it changes observable semantics or leads
  to memory safety.

## Stop Condition

Do not stop after replaying the three seed fixes. Stop this slice only when H1
through H5 are either confirmed, refuted with file/line guard, or blocked by a
specific missing runtime flag/build.
