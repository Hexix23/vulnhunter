// C7-H14: Exactness in indexed reference types must participate in cross-module
// function type matching. A function that only accepts exactly S must not link
// as an import that may be called with any subtype of S.

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

function exportingExactBaseParam() {
  const builder = new WasmModuleBuilder();
  const base = builder.addStruct({
    fields: [makeField(kWasmI32, true)],
    final: false,
  });
  const sig = builder.addType(makeSig([wasmRefType(base).exact()], [kWasmI32]));
  builder.addFunction("f", sig).addBody([kExprI32Const, 14]).exportFunc();
  return builder.instantiate({}).exports.f;
}

function importingInexactBaseParam(f) {
  const builder = new WasmModuleBuilder();
  const base = builder.addStruct({
    fields: [makeField(kWasmI32, true)],
    final: false,
  });
  const sig = builder.addType(makeSig([wasmRefType(base)], [kWasmI32]));
  builder.addImport("m", "f", sig);
  return builder.instantiate({m: {f}});
}

const f = exportingExactBaseParam();
mustLinkError(() => importingInexactBaseParam(f), "exact/inexact param merge");
print("OK");
