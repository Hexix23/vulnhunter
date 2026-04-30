// C21 H19: stale dispatch entry still blocked by call_indirect sig-check?
//
// H17/H18 show raw_type -> externref lets JS replace table entries with
// object/null without clearing trusted dispatch entries. This variant checks
// whether an incompatible stale dispatch entry can bypass call_indirect
// signature verification after the entry is hidden from JS.

d8.file.execute('test/mjsunit/wasm/wasm-module-builder.js');

const kHeapObjectTag = 1;
const kWasmTableObjectType =
    Sandbox.getInstanceTypeIdFor('WASM_TABLE_OBJECT_TYPE');
const kRawTypeOffset = Sandbox.getFieldOffset(kWasmTableObjectType, 'raw_type');
const memory = new DataView(new Sandbox.MemoryView(0, 0x100000000));

function tagged(obj) {
  return Sandbox.getAddressOf(obj) + kHeapObjectTag;
}

function rawTypeField(table) {
  return memory.getUint32(tagged(table) + kRawTypeOffset - kHeapObjectTag, true);
}

function corruptRawType(table, rawTypeSmi) {
  Sandbox.corruptObjectField(table, 'raw_type', rawTypeSmi);
}

let externTable = new WebAssembly.Table({element: 'externref', initial: 1});
let externRefRawTypeSmi = rawTypeField(externTable);

let b = new WasmModuleBuilder();
let sigGood = b.addType(kSig_i_i);
let sigBad = b.addType(kSig_i_ii);
let good = b.addFunction('good', sigGood)
    .addBody([kExprLocalGet, 0, kExprI32Const, 1, kExprI32Add])
    .exportFunc();
let bad = b.addFunction('bad', sigBad)
    .addBody([kExprLocalGet, 0, kExprLocalGet, 1, kExprI32Add])
    .exportFunc();
let table = b.addTable(kWasmFuncRef, 1, 1).exportAs('table');
b.addActiveElementSegment(table.index, wasmI32Const(0), [good.index]);
b.addFunction('call_good_sig', kSig_i_ii)
    .addBody([
      kExprLocalGet, 1,
      kExprLocalGet, 0,
      kExprCallIndirect, sigGood, table.index,
    ])
    .exportFunc();

let instance = b.instantiate();
let wasmTable = instance.exports.table;
let call = instance.exports.call_good_sig;

print(`good=${call(0, 7)}`);
wasmTable.set(0, instance.exports.bad);
try {
  print(`bad_direct=${call(0, 7)}`);
} catch (e) {
  print(`bad_direct_throw=${e.name}:${e.message}`);
}

corruptRawType(wasmTable, externRefRawTypeSmi);
wasmTable.set(0, null);
print(`entry_is_null=${wasmTable.get(0) === null}`);

try {
  print(`bad_hidden=${call(0, 7)}`);
} catch (e) {
  print(`bad_hidden_throw=${e.name}:${e.message}`);
}
