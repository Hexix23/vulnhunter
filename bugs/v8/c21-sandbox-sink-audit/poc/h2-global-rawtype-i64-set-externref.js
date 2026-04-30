// C21 H2: valid-but-false WasmGlobalObject.raw_type, setter path.
//
// i64 global storage is ByteArray[8]. After corrupting raw_type to externref,
// WebAssembly.Global.value setter accepts an object and SetRef() writes a
// tagged pointer through MaybeObjectSlot{storage()} into that numeric storage.

d8.file.execute('test/mjsunit/wasm/wasm-module-builder.js');

// raw_type is a Smi field. DebugPrint shows raw=0xb05; memory stores
// the tagged Smi value 0x160a.
const kExternRefRawTypeSmi = 0x160a;

let builder = new WasmModuleBuilder();
builder.addGlobal(kWasmI64, true, false, [kExprI64Const, 0]).exportAs('g');
let instance = builder.instantiate();
let global = instance.exports.g;

let marker = {x: 0x41414141};

print(`before=${global.value}`);

Sandbox.corruptObjectField(global, 'raw_type', kExternRefRawTypeSmi);

// Sink: WebAssemblyGlobalSetValueImpl -> JSToWasmObject -> SetRef.
global.value = marker;

// Force GC to exercise write barrier / object slot classification.
gc();
print(global.value === marker);
