// C7-H9: Same shared custom descriptor pair as H8, but descriptor allocation
// happens in a normal function body instead of a constant global initializer.

d8.file.execute("/Users/carlosgomez/v8-engagement/v8/v8/test/mjsunit/wasm/wasm-module-builder.js");

function assertEq(got, expected, label) {
  if (got !== expected) {
    throw new Error(label + ": got " + got + ", expected " + expected);
  }
}

const builder = new WasmModuleBuilder();
builder.startRecGroup();
const desc = builder.nextTypeIndex() + 1;
const s = builder.addStruct({
  fields: [makeField(kWasmI32, true)],
  descriptor: desc,
  shared: true,
});
builder.addStruct({fields: [], describes: s, shared: true});
builder.endRecGroup();

builder.addFunction("make", makeSig([kWasmI32], [wasmRefType(s)]))
  .addBody([
    kExprLocalGet, 0,
    kGCPrefix, kExprStructNewDefault, desc,
    kGCPrefix, kExprStructNewDesc, s,
  ])
  .exportFunc();

builder.addFunction("read", makeSig([wasmRefType(s)], [kWasmI32]))
  .addBody([
    kExprLocalGet, 0,
    kGCPrefix, kExprStructGet, s, 0,
  ])
  .exportFunc();

const instance = builder.instantiate({});
const obj = instance.exports.make(4321);
assertEq(instance.exports.read(obj), 4321, "shared descriptor runtime field");
print("OK");
