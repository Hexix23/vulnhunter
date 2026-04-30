// C7-H20: Self-recursive singleton groups should canonicalize equivalently
// across modules. This exercises the AddRecursiveSingletonGroup path.

d8.file.execute("/Users/carlosgomez/v8-engagement/v8/v8/test/mjsunit/wasm/wasm-module-builder.js");

function exportingSelfRecursive() {
  const builder = new WasmModuleBuilder();
  builder.startRecGroup();
  const node = builder.addStruct([makeField(wasmRefNullType(0), true)]);
  builder.endRecGroup();
  const sig = builder.addType(makeSig([wasmRefNullType(node)], [kWasmI32]));
  builder.addFunction("f", sig).addBody([kExprI32Const, 20]).exportFunc();
  return builder.instantiate({}).exports.f;
}

function importingSelfRecursive(f) {
  const builder = new WasmModuleBuilder();
  builder.startRecGroup();
  const node = builder.addStruct([makeField(wasmRefNullType(0), true)]);
  builder.endRecGroup();
  const sig = builder.addType(makeSig([wasmRefNullType(node)], [kWasmI32]));
  builder.addImport("m", "f", sig);
  return builder.instantiate({m: {f}});
}

const f = exportingSelfRecursive();
importingSelfRecursive(f);
print("OK");
