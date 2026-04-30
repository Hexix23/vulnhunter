// C21 H25: can generic hidden dispatch state be imported as typed table?
//
// Donor dispatch table is generic funcref and has entry1. Victim is a typed
// function table `(ref null good_sig)`. During grow, victim raw_type is
// corrupted to externref so new JS-visible entries become marker objects while
// trusted dispatch entries are copied from donor. Then victim raw_type is
// restored to typed-good and imported by a typed caller.
//
// Expected safe behavior: import-time SBXCHECK_EQ on dispatch_table.table_type.

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

function makeDonorTargets() {
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

function makeTypedVictim(f0) {
  let b = new WasmModuleBuilder();
  let sig = b.addType(kSig_i_i);
  let table = b.addTable(wasmRefNullType(sig), 1, 3).exportAs('table');
  b.addImportedGlobal('imp', 'f0', wasmRefNullType(sig), false);
  b.addActiveElementSegment(
      table.index, wasmI32Const(0), [[kExprGlobalGet, 0]],
      wasmRefNullType(sig));
  return b.instantiate({imp: {f0}}).exports.table;
}

function makeTypedCaller(table) {
  let b = new WasmModuleBuilder();
  let sig = b.addType(kSig_i_i);
  let t = b.addImportedTable('imp', 'table', 1, 3, wasmRefNullType(sig));
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
let {f0, f1} = makeDonorTargets();

let donor = new WebAssembly.Table({element: 'anyfunc', initial: 2, maximum: 2});
donor.set(0, f0);
donor.set(1, f1);

let victim = makeTypedVictim(f0);
let typedRawTypeSmi = rawTypeField(victim);

print(`typed_raw=0x${typedRawTypeSmi.toString(16)}`);
print(`externref_raw=0x${externRefRawTypeSmi.toString(16)}`);

write32(addrof(victim) + kTrustedDispatchTableOffset,
        read32(addrof(donor) + kTrustedDispatchTableOffset));
corruptRawType(victim, externRefRawTypeSmi);

let marker = {kind: 'typed-grow-marker'};
print(`grow_old=${victim.grow(2, marker)}`);
print(`entry1_is_marker=${victim.get(1) === marker}`);
corruptRawType(victim, typedRawTypeSmi);

try {
  let call = makeTypedCaller(victim);
  print(`typed_after0=${call(0, 7)}`);
  print(`typed_after1=${call(1, 7)}`);
} catch (e) {
  print(`typed_import_or_call_throw=${e.name}:${e.message}`);
}
