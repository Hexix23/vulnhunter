// C7-H11: Shipped Wasm GC canonicalization must not merge struct types whose
// field mutability differs.

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

function exportingMutable() {
  const builder = new WasmModuleBuilder();
  const s = builder.addStruct([makeField(kWasmI32, true)]);
  const sig = builder.addType(makeSig([wasmRefNullType(s)], [kWasmI32]));
  builder.addFunction("f", sig).addBody([kExprI32Const, 11]).exportFunc();
  return builder.instantiate({}).exports.f;
}

function importingImmutable(f) {
  const builder = new WasmModuleBuilder();
  const s = builder.addStruct([makeField(kWasmI32, false)]);
  const sig = builder.addType(makeSig([wasmRefNullType(s)], [kWasmI32]));
  builder.addImport("m", "f", sig);
  return builder.instantiate({m: {f}});
}

const f = exportingMutable();
mustLinkError(() => importingImmutable(f), "mutable/immutable field merge");
print("OK");
