// C7-H15: Exactness in return types must participate in cross-module function
// type matching.

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

function exportingInexactReturn() {
  const builder = new WasmModuleBuilder();
  const s = builder.addStruct({
    fields: [makeField(kWasmI32, true)],
    final: false,
  });
  const sig = builder.addType(makeSig([], [wasmRefType(s)]));
  builder.addFunction("f", sig).addBody([
    kExprI32Const, 15,
    kGCPrefix, kExprStructNew, s,
  ]).exportFunc();
  return builder.instantiate({}).exports.f;
}

function importingExactReturn(f) {
  const builder = new WasmModuleBuilder();
  const s = builder.addStruct({
    fields: [makeField(kWasmI32, true)],
    final: false,
  });
  const sig = builder.addType(makeSig([], [wasmRefType(s).exact()]));
  builder.addImport("m", "f", sig);
  return builder.instantiate({m: {f}});
}

const f = exportingInexactReturn();
mustLinkError(() => importingExactReturn(f), "exact/inexact return merge");
print("OK");
