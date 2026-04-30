// C7-H5: Mutual supertypes inside one recursive group must be rejected. If
// accepted, IsCanonicalSubtype_Locked() would walk a cyclic supertype chain.

d8.file.execute("/Users/carlosgomez/v8-engagement/v8/v8/test/mjsunit/wasm/wasm-module-builder.js");

function assertThrows(fn, ctor) {
  try {
    fn();
  } catch (e) {
    if (!(e instanceof ctor)) throw new Error("wrong exception: " + e);
    return;
  }
  throw new Error("expected exception");
}

const builder = new WasmModuleBuilder();
const t0 = builder.nextTypeIndex();
const t1 = t0 + 1;
builder.startRecGroup();
builder.addStruct({fields: [makeField(kWasmI32, true)], supertype: t1});
builder.addStruct({fields: [makeField(kWasmI64, true)], supertype: t0});
builder.endRecGroup();

assertThrows(() => new WebAssembly.Module(builder.toBuffer()),
             WebAssembly.CompileError);
print("OK");
