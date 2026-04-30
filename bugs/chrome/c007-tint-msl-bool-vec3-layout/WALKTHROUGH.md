# C007 Tint MSL Bool Vec3 Layout Walkthrough

Goal: variant hunt from Dawn patch
`049880d58d6636a819168c00f44f8a4ed1e33e51`, referenced by Chromium stable
range `147.0.7727.136..147.0.7727.137`.

## Fixed bug fingerprint

Patch subject: `[M147] [msl] Fix issue in FixTypeLayout without bool vectors.`

Core fix in `third_party/dawn/src/tint/lang/msl/writer/raise/fix_type_layout.cc`:

```diff
- new_elem_type = GetPackedVec3ArrayElementStruct(vec->Type());
+ if (vec->Type()->Is<core::type::Bool>()) {
+   new_elem_type = GetPackedVec3ArrayElementStruct(ty.u32());
+ } else {
+   new_elem_type = GetPackedVec3ArrayElementStruct(vec->Type());
+ }
```

The original bug class: MSL backend packed `array<vec3<bool>>` as if a packed
bool vector existed. MSL packed bool vector types are reserved/problematic, so
Tint must lower bool vector storage to `u32` and convert on load/store.

Public CVE mapping from Chrome release: CVE-2026-7346, high severity,
"Inappropriate implementation in Tint".

## Source invariants

- `AddressSpaceNeedsPacking()` includes host-shareable spaces and `workgroup`.
- Workgroup is the relevant attacker-controlled WGSL path because bool is not
  host-shareable, but workgroup supports bool.
- `RewriteType(Vector width==3)` converts `vec3<bool>` to `__packed_vec3<u32>`.
- `RewriteArray()` must wrap direct `array<vec3<T>>` elements in a struct so
  the array stride keeps vec3 alignment. The patch special-cases bool to use
  wrapper element `u32`, not `bool`.
- `ElementTypeUsesWrapperStruct()` only returns true for matrix rows==3 and
  arrays whose direct element type is vector width 3.
- `UpdateAccessUsage()` adds an extra `, 0u` index only when the current object
  type directly uses such a wrapper.
- `LoadVectorElement` / `StoreVectorElement` convert scalar `u32 <-> bool` only
  when the unpacked pointer type unwraps to a bool vector.
- Whole `load` / `store` of arrays and structs go through helper functions
  (`LoadPackedArrayHelper`, `StorePackedArrayHelper`,
  `LoadPackedStructHelper`, `StorePackedStructHelper`) and must preserve the
  same conversion invariant as direct vector element access.

## Existing coverage gap

The upstream regression test covers only direct:

```cpp
var<workgroup, array<vec3<bool>, 1>>
access v, 0u
load_vector_element
```

It does not cover nested arrays, struct-containing arrays, array-containing
structs, whole composite load/store, or pointer parameters. Those are the first
variant probes.

## Hypotheses

H1 nested array direct element:
`array<array<vec3<bool>, 2>, 2>` should add wrapper index only at the inner
array level. Bad result would be missing extra index, wrong pointer type, or
`__packed_vec3<bool>`.

H2 whole nested array load/store:
The helper path recursively loads/stores arrays. Bad result would be helper
emitting bool packed storage, missing u32 conversions, or using wrong array
stride for nested packed wrapper elements.

H3 struct containing array vec3 bool:
`struct S { data: array<vec3<bool>, 2> }` should rewrite member type to
`array<tint_packed_vec3_u32_array_element, 2>` and convert on both member and
element access.

H4 array of struct containing vec3 bool:
`array<S, 2>` where `S { data: vec3<bool> }` does not trigger
`ElementTypeUsesWrapperStruct()` at the outer array. The struct member rewrite
must still make `a[i].data[j]` point to `__packed_vec3<u32>` and convert scalar
loads/stores.

H5 pointer parameter:
Function parameter `ptr<workgroup, array<vec3<bool>, 2>>` is rewritten by the
second `Process()` loop, not the module variable loop. Bad result would be
module vars fixed but pointer params left with bool packed vector layout.

## Current execution state

The full Chromium ASAN build makes even focused Dawn/Tint unit targets pull
thousands of ninja steps in this checkout. I stopped the build rather than burn
hours blindly. Next execution path should be either:

- finish the already-started Tint unit target once machine resources allow, or
- create a smaller standalone Dawn/Tint build and run only
  `MslWriter_FixTypeLayoutTest` variants.

No reportable finding yet. C007 is a strong variant cluster, not confirmed.
