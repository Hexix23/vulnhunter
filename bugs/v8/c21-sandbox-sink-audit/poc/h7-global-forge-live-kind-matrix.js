// C21 H7: live forged-reference object-kind matrix.
//
// For each object kind, store its tagged pointer bytes in i64 global storage,
// flip raw_type to externref, then verify the recovered reference still behaves
// as that object kind.

d8.file.execute('test/mjsunit/wasm/wasm-module-builder.js');

const kHeapObjectTag = 1;
const kExternRefRawTypeSmi = 0x160a;

function newI64Global() {
  let builder = new WasmModuleBuilder();
  builder.addGlobal(kWasmI64, true, false, [kExprI64Const, 0]).exportAs('g');
  return builder.instantiate().exports.g;
}

function forge(obj) {
  let global = newI64Global();
  global.value = BigInt(Sandbox.getAddressOf(obj) + kHeapObjectTag);
  Sandbox.corruptObjectField(global, 'raw_type', kExternRefRawTypeSmi);
  return global.value;
}

let cases = [
  ['object', {tag: 'obj', marker: 1}, x => x.tag],
  ['array', [11, 22, 33], x => `${Array.isArray(x)}:${x.length}:${x[1]}`],
  ['function', function f() { return 77; }, x => `${typeof x}:${x()}`],
  ['arraybuffer', new ArrayBuffer(16), x => `${x.byteLength}`],
  ['typedarray', new Uint32Array([7, 8, 9]), x => `${x.length}:${x[2]}`],
  ['stringobject', new String('abc'), x => `${x.valueOf()}:${x.length}`],
];

for (let [name, obj, observe] of cases) {
  let recovered = forge(obj);
  print(`${name}:same=${recovered === obj}:obs=${observe(recovered)}`);
}
