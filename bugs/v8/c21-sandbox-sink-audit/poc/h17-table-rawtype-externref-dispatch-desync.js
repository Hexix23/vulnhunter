// C21 H17: WasmTableObject.raw_type funcref -> externref dispatch desync.
//
// A funcref table owns a trusted dispatch table used by call_indirect. If
// raw_type is corrupted to externref, WebAssembly.Table.set() validates and
// stores arbitrary JS refs as plain entries, and WasmTableObject::Set() no
// longer calls SetFunctionTableEntry()/ClearDispatchTable().
//
// Goal: prove entries can say "object/null" while call_indirect still uses the
// stale trusted dispatch entry.

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

let builder = new WasmModuleBuilder();
let sig = builder.addType(kSig_i_i);
let f0 = builder.addFunction('f0', sig)
    .addBody([kExprLocalGet, 0, kExprI32Const, 0x10, kExprI32Add])
    .exportFunc();
let f1 = builder.addFunction('f1', sig)
    .addBody([kExprLocalGet, 0, kExprI32Const, 0x20, kExprI32Add])
    .exportFunc();
let table = builder.addTable(kWasmFuncRef, 1, 1).exportAs('table');
builder.addActiveElementSegment(table.index, wasmI32Const(0), [f0.index]);
builder.addFunction('call', kSig_i_ii)
    .addBody([
      kExprLocalGet, 1,
      kExprLocalGet, 0,
      kExprCallIndirect, sig, table.index,
    ])
    .exportFunc();

let instance = builder.instantiate();
let wasmTable = instance.exports.table;
let call = instance.exports.call;

print(`funcref_raw=0x${rawTypeField(wasmTable).toString(16)}`);
print(`externref_raw=0x${externRefRawTypeSmi.toString(16)}`);
print(`baseline=${call(0, 7)}`);

wasmTable.set(0, instance.exports.f1);
print(`after_func_set=${call(0, 7)}`);

corruptRawType(wasmTable, externRefRawTypeSmi);
let marker = {kind: 'not-a-function'};
wasmTable.set(0, marker);
print(`entry_is_marker=${wasmTable.get(0) === marker}`);

try {
  print(`after_object_set_call=${call(0, 7)}`);
} catch (e) {
  print(`after_object_set_call_throw=${e.name}:${e.message}`);
}

wasmTable.set(0, null);
print(`entry_is_null=${wasmTable.get(0) === null}`);

try {
  print(`after_null_set_call=${call(0, 7)}`);
} catch (e) {
  print(`after_null_set_call_throw=${e.name}:${e.message}`);
}
