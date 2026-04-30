// C7-H13: Shipped Wasm GC canonicalization must not merge array types whose
// element mutability differs.

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

function exportingMutableArray() {
  const builder = new WasmModuleBuilder();
  const a = builder.addArray(kWasmI32, {mutable: true});
  const sig = builder.addType(makeSig([wasmRefNullType(a)], [kWasmI32]));
  builder.addFunction("f", sig).addBody([kExprI32Const, 13]).exportFunc();
  return builder.instantiate({}).exports.f;
}

function importingImmutableArray(f) {
  const builder = new WasmModuleBuilder();
  const a = builder.addArray(kWasmI32, {mutable: false});
  const sig = builder.addType(makeSig([wasmRefNullType(a)], [kWasmI32]));
  builder.addImport("m", "f", sig);
  return builder.instantiate({m: {f}});
}

const f = exportingMutableArray();
mustLinkError(() => importingImmutableArray(f), "array mutability merge");
print("OK");
