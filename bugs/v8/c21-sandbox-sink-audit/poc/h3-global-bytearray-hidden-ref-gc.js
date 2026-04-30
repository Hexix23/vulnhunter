// C21 H3: object pointer hidden in numeric global ByteArray, then GC pressure.
//
// If SetRef() writes an object pointer into ByteArray storage after raw_type
// corruption, GC must either trace/update that hidden slot or the getter can
// later read a stale pointer.

d8.file.execute('test/mjsunit/wasm/wasm-module-builder.js');

const kExternRefRawTypeSmi = 0x160a;

let builder = new WasmModuleBuilder();
builder.addGlobal(kWasmI64, true, false, [kExprI64Const, 0]).exportAs('g');
let instance = builder.instantiate();
let global = instance.exports.g;

Sandbox.corruptObjectField(global, 'raw_type', kExternRefRawTypeSmi);

(function() {
  let marker = {tag: 'hidden-ref', payload: new Array(1024).fill(13)};
  global.value = marker;
  print(global.value.tag);
})();

// The only intended remaining reference is the hidden pointer in ByteArray.
for (let r = 0; r < 20; r++) {
  let junk = [];
  for (let i = 0; i < 20000; i++) junk.push({i, pad: [i, i + 1, i + 2]});
  gc();
}

let recovered = global.value;
print(recovered && recovered.tag);
print(recovered && recovered.payload && recovered.payload[0]);
