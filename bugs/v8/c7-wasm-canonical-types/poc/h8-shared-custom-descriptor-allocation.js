// C7-H8: Shared custom descriptors are accepted by validity tests; exercise
// runtime allocation so canonical descriptor/describes IDs feed object creation.

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

const descType = wasmRefType(desc).exact();
const descGlobal = builder.addGlobal(descType, false, false, [
  kGCPrefix, kExprStructNew, desc,
]);

builder.addFunction("make", makeSig([kWasmI32], [wasmRefType(s)]))
  .addBody([
    kExprLocalGet, 0,
    kExprGlobalGet, descGlobal.index,
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
const obj = instance.exports.make(1234);
assertEq(instance.exports.read(obj), 1234, "shared descriptor object field");
print("OK");
