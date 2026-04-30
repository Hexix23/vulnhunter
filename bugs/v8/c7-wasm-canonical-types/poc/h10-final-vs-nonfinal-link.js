// C7-H10: Shipped Wasm GC canonicalization must not merge otherwise identical
// final and non-final struct types across modules.

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

function exportingFinal() {
  const builder = new WasmModuleBuilder();
  const s = builder.addStruct({
    fields: [makeField(kWasmI32, true)],
    final: true,
  });
  const sig = builder.addType(makeSig([wasmRefNullType(s)], [kWasmI32]));
  builder.addFunction("f", sig).addBody([kExprI32Const, 10]).exportFunc();
  return builder.instantiate({}).exports.f;
}

function importingNonFinal(f) {
  const builder = new WasmModuleBuilder();
  const s = builder.addStruct({
    fields: [makeField(kWasmI32, true)],
    final: false,
  });
  const sig = builder.addType(makeSig([wasmRefNullType(s)], [kWasmI32]));
  builder.addImport("m", "f", sig);
  return builder.instantiate({m: {f}});
}

const f = exportingFinal();
mustLinkError(() => importingNonFinal(f), "final/non-final canonical merge");
print("OK");
