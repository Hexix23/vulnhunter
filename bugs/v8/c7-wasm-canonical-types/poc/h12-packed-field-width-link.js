// C7-H12: Shipped Wasm GC canonicalization must not merge packed fields with
// different storage widths.

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

function exportingI8() {
  const builder = new WasmModuleBuilder();
  const s = builder.addStruct([makeField(kWasmI8, true)]);
  const sig = builder.addType(makeSig([wasmRefNullType(s)], [kWasmI32]));
  builder.addFunction("f", sig).addBody([kExprI32Const, 12]).exportFunc();
  return builder.instantiate({}).exports.f;
}

function importingI16(f) {
  const builder = new WasmModuleBuilder();
  const s = builder.addStruct([makeField(kWasmI16, true)]);
  const sig = builder.addType(makeSig([wasmRefNullType(s)], [kWasmI32]));
  builder.addImport("m", "f", sig);
  return builder.instantiate({m: {f}});
}

const f = exportingI8();
mustLinkError(() => importingI16(f), "i8/i16 packed field merge");
print("OK");
