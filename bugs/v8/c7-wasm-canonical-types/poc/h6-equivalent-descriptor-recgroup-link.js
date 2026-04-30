// C7-H6: Equivalent custom descriptor/describes pairs must canonicalize across
// modules. This specifically covers CanonicalType::descriptor/describes remap.

d8.file.execute("/Users/carlosgomez/v8-engagement/v8/v8/test/mjsunit/wasm/wasm-module-builder.js");

function makeDescriptorPair(builder) {
  builder.startRecGroup();
  const s = builder.addStruct({
    fields: [makeField(kWasmI32, true)],
    descriptor: 1,
  });
  builder.addStruct({fields: [], describes: s});
  builder.endRecGroup();
  return s;
}

function buildExportingInstance() {
  const builder = new WasmModuleBuilder();
  const s = makeDescriptorPair(builder);
  const sig = builder.addType(makeSig([wasmRefNullType(s)], [kWasmI32]));
  builder.addFunction("f", sig).addBody([kExprI32Const, 13]).exportFunc();
  return builder.instantiate({});
}

function buildImportingInstance(f) {
  const builder = new WasmModuleBuilder();
  const s = makeDescriptorPair(builder);
  const sig = builder.addType(makeSig([wasmRefNullType(s)], [kWasmI32]));
  builder.addImport("m", "f", sig);
  return builder.instantiate({m: {f}});
}

const exported = buildExportingInstance().exports.f;
buildImportingInstance(exported);
print("OK");
