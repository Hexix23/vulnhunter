// C7-H16: A mutable struct field in an explicit subtype must be invariant.
// Accepting a narrower mutable field would permit writes through the supertype
// that violate the subtype's field contract.

d8.file.execute("/Users/carlosgomez/v8-engagement/v8/v8/test/mjsunit/wasm/wasm-module-builder.js");

function mustCompileError(builder, label) {
  try {
    builder.instantiate({});
  } catch (e) {
    if (e instanceof WebAssembly.CompileError) return;
    throw new Error(label + ": wrong error: " + e);
  }
  throw new Error(label + ": expected CompileError");
}

const builder = new WasmModuleBuilder();
const base = builder.addStruct({fields: [], final: false});
const derived = builder.addStruct({fields: [], supertype: base});
const superStruct = builder.addStruct({
  fields: [makeField(wasmRefNullType(base), true)],
  final: false,
});
builder.addStruct({
  fields: [makeField(wasmRefNullType(derived), true)],
  supertype: superStruct,
});

mustCompileError(builder, "mutable struct field covariance");
print("OK");
