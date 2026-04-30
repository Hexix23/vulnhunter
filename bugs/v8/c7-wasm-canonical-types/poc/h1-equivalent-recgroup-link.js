// C7-H1: Two independently compiled modules with isomorphic recursive groups
// must canonicalize to the same canonical type IDs. If they do not, import
// link-time type matching rejects a valid export/import pair.

d8.file.execute("/Users/carlosgomez/v8-engagement/v8/v8/test/mjsunit/wasm/wasm-module-builder.js");

function assertEq(got, expected, label) {
  if (got !== expected) {
    throw new Error(label + ": got " + got + ", expected " + expected);
  }
}

function buildExportingInstance() {
  const builder = new WasmModuleBuilder();
  builder.startRecGroup();
  const a = builder.addStruct([makeField(wasmRefNullType(1), true)]);
  const b = builder.addStruct([makeField(wasmRefNullType(0), true)]);
  builder.endRecGroup();
  const sig = builder.addType(makeSig([wasmRefNullType(a)], [kWasmI32]));
  builder.addFunction("f", sig).addBody([kExprI32Const, 0x2a]).exportFunc();
  return builder.instantiate({});
}

function buildImportingInstance(f) {
  const builder = new WasmModuleBuilder();
  builder.startRecGroup();
  const a = builder.addStruct([makeField(wasmRefNullType(1), true)]);
  builder.addStruct([makeField(wasmRefNullType(0), true)]);
  builder.endRecGroup();
  const sig = builder.addType(makeSig([wasmRefNullType(a)], [kWasmI32]));
  builder.addImport("m", "f", sig);
  return builder.instantiate({m: {f}});
}

const exported = buildExportingInstance().exports.f;
buildImportingInstance(exported);
assertEq(exported(null), 0x2a, "export call");
print("OK");
