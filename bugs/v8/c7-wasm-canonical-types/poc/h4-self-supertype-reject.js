// C7-H4: A recursive group that gives a type itself as supertype must be
// rejected before canonicalization can install a cyclic canonical_supertypes_
// chain.

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
const self = builder.nextTypeIndex();
builder.startRecGroup();
builder.addStruct({fields: [makeField(kWasmI32, true)], supertype: self});
builder.endRecGroup();

assertThrows(() => new WebAssembly.Module(builder.toBuffer()),
             WebAssembly.CompileError);
print("OK");
