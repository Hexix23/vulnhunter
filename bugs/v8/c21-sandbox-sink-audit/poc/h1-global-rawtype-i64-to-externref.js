// C21 H1: valid-but-false WasmGlobalObject.raw_type.
//
// Existing upstream test corrupts raw_type to an invalid encoding. This variant
// uses a valid externref raw type on an i64 global, forcing GetRef() to read an
// ObjectSlot from a ByteArray-backed numeric global.

d8.file.execute('test/mjsunit/wasm/wasm-module-builder.js');

// raw_type is a Smi field. DebugPrint shows raw=0xb05; memory stores
// the tagged Smi value 0x160a.
const kExternRefRawTypeSmi = 0x160a;

let builder = new WasmModuleBuilder();
builder.addGlobal(kWasmI64, true, false, [kExprI64Const, 0]).exportAs('g');
let instance = builder.instantiate();
let global = instance.exports.g;

print(`before=${global.value}`);

Sandbox.corruptObjectField(global, 'raw_type', kExternRefRawTypeSmi);

// Sink: WebAssemblyGlobalGetValueCommon -> GetRef -> ObjectSlot{storage()}.
print(global.value);
