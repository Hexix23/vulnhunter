// C7-H21: A singleton self-recursive type must not canonicalize as a two-node
// mutually recursive group with similar local edges.

d8.file.execute("/Users/carlosgomez/v8-engagement/v8/v8/test/mjsunit/wasm/wasm-module-builder.js");

function mustLinkError(fn, label) {
  try {
    fn();
  } catch (e) {
    if (e instanceof WebAssembly.LinkError) return;
    throw new Error(label + ": wrong error: " + e);
  }
  throw new Error(label + ": expected LinkError");
}

function exportingSelfRecursive() {
  const builder = new WasmModuleBuilder();
  builder.startRecGroup();
  const node = builder.addStruct([makeField(wasmRefNullType(0), true)]);
  builder.endRecGroup();
  const sig = builder.addType(makeSig([wasmRefNullType(node)], [kWasmI32]));
  builder.addFunction("f", sig).addBody([kExprI32Const, 21]).exportFunc();
  return builder.instantiate({}).exports.f;
}

function importingMutualRecursive(f) {
  const builder = new WasmModuleBuilder();
  builder.startRecGroup();
  const a = builder.addStruct([makeField(wasmRefNullType(1), true)]);
  builder.addStruct([makeField(wasmRefNullType(0), true)]);
  builder.endRecGroup();
  const sig = builder.addType(makeSig([wasmRefNullType(a)], [kWasmI32]));
  builder.addImport("m", "f", sig);
  return builder.instantiate({m: {f}});
}

const f = exportingSelfRecursive();
mustLinkError(() => importingMutualRecursive(f), "singleton/two-node merge");
print("OK");
