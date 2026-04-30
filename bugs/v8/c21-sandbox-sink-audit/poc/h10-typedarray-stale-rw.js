// C21 H10: typedarray stale forged reference read/write check.
//
// Goal: determine whether forged typedarray ref after GC is a useful read/write
// object, same relocated object, or stale crash/filler. Prints old/new addresses
// when WeakRef still sees the original target.

d8.file.execute('test/mjsunit/wasm/wasm-module-builder.js');

const kHeapObjectTag = 1;
const kExternRefRawTypeSmi = 0x160a;
const rounds = globalThis.H10_ROUNDS || 10;
const doAlloc = globalThis.H10_ALLOC !== false;

let builder = new WasmModuleBuilder();
builder.addGlobal(kWasmI64, true, false, [kExprI64Const, 0]).exportAs('g');
let global = builder.instantiate().exports.g;

let weak;
let oldTagged;
(function() {
  let target = new Uint32Array([0x1111, 0x2222, 0x3333, 0x4444]);
  weak = new WeakRef(target);
  oldTagged = Sandbox.getAddressOf(target) + kHeapObjectTag;
  print(`old=0x${oldTagged.toString(16)}`);
  print(`before=${target.length}:${target[0]}:${target[3]}`);
  global.value = BigInt(oldTagged);
})();

Sandbox.corruptObjectField(global, 'raw_type', kExternRefRawTypeSmi);

for (let r = 0; r < rounds; r++) {
  if (doAlloc) {
    let junk = [];
    for (let i = 0; i < 30000; i++) junk.push({i, a: i ^ 0x5151});
  }
  gc();
}

let weakValue = weak.deref();
if (weakValue) {
  let newTagged = Sandbox.getAddressOf(weakValue) + kHeapObjectTag;
  print(`weak=live:0x${newTagged.toString(16)}:${weakValue.length}:${weakValue[0]}:${weakValue[3]}`);
  print(`moved=${newTagged !== oldTagged}`);
} else {
  print('weak=cleared');
}

let recovered = global.value;
print(`same=${weakValue ? recovered === weakValue : 'no-weak'}`);
print(`rec_type=${Object.prototype.toString.call(recovered)}`);
print(`rec=${recovered.length}:${recovered[0]}:${recovered[3]}`);
recovered[1] = 0xdeadbeef;
print(`rec_after_write=${recovered[1]}`);
if (weakValue) print(`weak_after_write=${weakValue[1]}`);
