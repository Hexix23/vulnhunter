// C21 H0: read actual WasmGlobalObject.raw_type field values from memory.
//
// Sandbox.getInstanceTypeIdFor does not expose WASM_GLOBAL_OBJECT_TYPE, so use
// the known TQ layout on this x64 build: raw_type is after trusted_data,
// buffer, and offset in WasmGlobalObject, at JSObject header + 12 = 0x18.

d8.file.execute('test/mjsunit/wasm/wasm-module-builder.js');

const kHeapObjectTag = 1;
const kWasmGlobalObjectRawTypeOffset = 0x18;
const memory = new DataView(new Sandbox.MemoryView(0, 0x100000000));

function getPtr(obj) {
  return Sandbox.getAddressOf(obj) + kHeapObjectTag;
}

function getField(obj, offset) {
  return memory.getUint32(obj + offset - kHeapObjectTag, true);
}

let b1 = new WasmModuleBuilder();
b1.addGlobal(kWasmI64, true, false, [kExprI64Const, 0]).exportAs('g');
let i64 = b1.instantiate().exports.g;

let b2 = new WasmModuleBuilder();
b2.addGlobal(kWasmExternRef, true, false, [kExprRefNull, kExternRefCode])
  .exportAs('g');
let ext = b2.instantiate().exports.g;

print(`i64_mem=0x${getField(getPtr(i64), kWasmGlobalObjectRawTypeOffset).toString(16)}`);
print(`externref_mem=0x${getField(getPtr(ext), kWasmGlobalObjectRawTypeOffset).toString(16)}`);

%DebugPrint(i64);
%DebugPrint(ext);
