// C7-H22: A type that references an earlier equivalent type must not be merged
// with a type that references an in-group type at the same relative slot.

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

function exportingExternalRefShape() {
  const builder = new WasmModuleBuilder();
  const ext = builder.addStruct([makeField(kWasmI32, true)]);
  builder.startRecGroup();
  const s = builder.addStruct([makeField(wasmRefNullType(ext), true)]);
  builder.endRecGroup();
  const sig = builder.addType(makeSig([wasmRefNullType(s)], [kWasmI32]));
  builder.addFunction("f", sig).addBody([kExprI32Const, 22]).exportFunc();
  return builder.instantiate({}).exports.f;
}

function importingInternalRefShape(f) {
  const builder = new WasmModuleBuilder();
  builder.addStruct([makeField(kWasmI32, true)]);
  builder.startRecGroup();
  const sIndex = builder.nextTypeIndex();
  const s = builder.addStruct([makeField(wasmRefNullType(sIndex), true)]);
  builder.endRecGroup();
  const sig = builder.addType(makeSig([wasmRefNullType(s)], [kWasmI32]));
  builder.addImport("m", "f", sig);
  return builder.instantiate({m: {f}});
}

const f = exportingExternalRefShape();
mustLinkError(() => importingInternalRefShape(f), "external/internal ref merge");
print("OK");
