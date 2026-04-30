// C7-H18: A mutable array element in an explicit subtype must be invariant.

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
const superArray = builder.addArray(wasmRefNullType(base), {
  mutable: true,
  final: false,
});
builder.addArray(wasmRefNullType(derived), {
  mutable: true,
  supertype: superArray,
});

mustCompileError(builder, "mutable array element covariance");
print("OK");
