// C7-H17: Immutable struct fields may be covariant. This positive control
// verifies the H16 shape is not simply rejected because of indexed refs.

d8.file.execute("/Users/carlosgomez/v8-engagement/v8/v8/test/mjsunit/wasm/wasm-module-builder.js");

const builder = new WasmModuleBuilder();
const base = builder.addStruct({fields: [], final: false});
const derived = builder.addStruct({fields: [], supertype: base});
const superStruct = builder.addStruct({
  fields: [makeField(wasmRefNullType(base), false)],
  final: false,
});
builder.addStruct({
  fields: [makeField(wasmRefNullType(derived), false)],
  supertype: superStruct,
});

builder.instantiate({});
print("OK");
