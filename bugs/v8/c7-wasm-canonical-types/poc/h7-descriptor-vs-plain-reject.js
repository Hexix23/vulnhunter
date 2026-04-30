// C7-H7: A described struct and a plain struct with identical fields must not
// canonicalize together. Descriptor/describes are part of type identity.

d8.file.execute("/Users/carlosgomez/v8-engagement/v8/v8/test/mjsunit/wasm/wasm-module-builder.js");

function assertThrows(fn, ctor, pattern) {
  try {
    fn();
  } catch (e) {
    if (!(e instanceof ctor)) throw new Error("wrong exception: " + e);
    if (pattern && !pattern.test(String(e))) {
      throw new Error("wrong message: " + e);
    }
    return;
  }
  throw new Error("expected exception");
}

function buildDescribedExport() {
  const builder = new WasmModuleBuilder();
  builder.startRecGroup();
  const s = builder.addStruct({
    fields: [makeField(kWasmI32, true)],
    descriptor: 1,
  });
  builder.addStruct({fields: [], describes: s});
  builder.endRecGroup();
  const sig = builder.addType(makeSig([wasmRefNullType(s)], [kWasmI32]));
  builder.addFunction("f", sig).addBody([kExprI32Const, 17]).exportFunc();
  return builder.instantiate({});
}

function buildPlainImport(f) {
  const builder = new WasmModuleBuilder();
  const s = builder.addStruct([makeField(kWasmI32, true)]);
  const sig = builder.addType(makeSig([wasmRefNullType(s)], [kWasmI32]));
  builder.addImport("m", "f", sig);
  return builder.instantiate({m: {f}});
}

const exported = buildDescribedExport().exports.f;
assertThrows(() => buildPlainImport(exported), WebAssembly.LinkError,
             /imported function does not match the expected type/);
print("OK");
