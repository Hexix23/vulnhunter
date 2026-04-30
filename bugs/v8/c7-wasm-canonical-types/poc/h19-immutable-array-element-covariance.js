// C7-H19: Immutable array elements may be covariant. Positive control for H18.

d8.file.execute("/Users/carlosgomez/v8-engagement/v8/v8/test/mjsunit/wasm/wasm-module-builder.js");

const builder = new WasmModuleBuilder();
const base = builder.addStruct({fields: [], final: false});
const derived = builder.addStruct({fields: [], supertype: base});
const superArray = builder.addArray(wasmRefNullType(base), {
  mutable: false,
  final: false,
});
builder.addArray(wasmRefNullType(derived), {
  mutable: false,
  supertype: superArray,
});

builder.instantiate({});
print("OK");
