// C7-H3: Function signatures that differ only by nullable vs non-nullable
// typed refs must remain distinct. A function returning (ref null T) cannot
// satisfy an import expecting a function returning (ref T).

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

function buildNullableReturnExport() {
  const builder = new WasmModuleBuilder();
  const t = builder.addStruct([makeField(kWasmI32, true)]);
  const sig = builder.addType(makeSig([], [wasmRefNullType(t)]));
  builder.addFunction("f", sig).addBody([kExprRefNull, t]).exportFunc();
  return builder.instantiate({});
}

function buildNonNullReturnImport(f) {
  const builder = new WasmModuleBuilder();
  const t = builder.addStruct([makeField(kWasmI32, true)]);
  const sig = builder.addType(makeSig([], [wasmRefType(t)]));
  builder.addImport("m", "f", sig);
  return builder.instantiate({m: {f}});
}

const exported = buildNullableReturnExport().exports.f;
assertThrows(() => buildNonNullReturnImport(exported), WebAssembly.LinkError,
             /imported function does not match the expected type/);
print("OK");
