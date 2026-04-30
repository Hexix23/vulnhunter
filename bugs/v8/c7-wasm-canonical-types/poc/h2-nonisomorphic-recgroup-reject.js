// C7-H2: Similar-looking recursive groups with different internal edges must
// not canonicalize to the same IDs. A false merge would allow an import to link
// against a structurally incompatible exported function.

d8.file.execute("/Users/carlosgomez/v8-engagement/v8/v8/test/mjsunit/wasm/wasm-module-builder.js");

function assertThrows(fn, ctor, pattern) {
  try {
    fn();
  } catch (e) {
    if (!(e instanceof ctor)) {
      throw new Error("wrong exception: " + e);
    }
    if (pattern && !pattern.test(String(e))) {
      throw new Error("wrong message: " + e);
    }
    return;
  }
  throw new Error("expected exception");
}

function buildExportingInstance() {
  const builder = new WasmModuleBuilder();
  builder.startRecGroup();
  const a = builder.addStruct([makeField(wasmRefNullType(0), true)]);
  builder.addStruct([makeField(kWasmI32, true)]);
  builder.endRecGroup();
  const sig = builder.addType(makeSig([wasmRefNullType(a)], [kWasmI32]));
  builder.addFunction("f", sig).addBody([kExprI32Const, 7]).exportFunc();
  return builder.instantiate({});
}

function buildImportingInstance(f) {
  const builder = new WasmModuleBuilder();
  builder.startRecGroup();
  const a = builder.addStruct([makeField(wasmRefNullType(1), true)]);
  builder.addStruct([makeField(kWasmI32, true)]);
  builder.endRecGroup();
  const sig = builder.addType(makeSig([wasmRefNullType(a)], [kWasmI32]));
  builder.addImport("m", "f", sig);
  return builder.instantiate({m: {f}});
}

const exported = buildExportingInstance().exports.f;
assertThrows(() => buildImportingInstance(exported), WebAssembly.LinkError,
             /imported function does not match the expected type/);
print("OK");
