d8.file.execute('/Users/carlosgomez/v8-engagement/v8/v8/test/mjsunit/wasm/wasm-module-builder.js');

// Reduced from V8's regress-497667917. This is a C3b variant probe for stale
// cached Wasm memory base across stack switching plus memory.grow.
let builder = new WasmModuleBuilder();
const mem = builder.addMemory(1, 10000, false);

let sig_v_v = builder.addType(kSig_v_v);
let cont_v_v = builder.addCont(sig_v_v);
let sig_v_c = builder.addType(makeSig([wasmRefNullType(cont_v_v)], []));
let cont_v_c = builder.addCont(sig_v_c);
let sig_v_c2 = builder.addType(makeSig([wasmRefNullType(cont_v_c)], []));
let cont_v_c2 = builder.addCont(sig_v_c2);

let tag = builder.addTag(kSig_v_v);
let g = builder.addGlobal(kWasmI32, true).exportAs('g');

let grower = builder.addFunction('grower', sig_v_c2).addBody([
  ...wasmI32Const(500), kExprMemoryGrow, mem, kExprDrop,
  kExprLocalGet, 0,
  kExprSwitch, cont_v_c, tag,
  kExprUnreachable,
]);

let reader = builder.addFunction('reader', sig_v_c).addBody([
  kExprLocalGet, 0,
  kExprDrop,
  kExprRefFunc, grower.index,
  kExprContNew, cont_v_c2,
  kExprSwitch, cont_v_c2, tag,
  kExprDrop,
  // If mem_start_ is stale after the switch/grow, this load can read freed
  // backing-store memory under --stress-wasm-memory-moving.
  kExprI32Const, 0,
  kExprI32LoadMem, 2, 0,
  kExprGlobalSet, g.index,
]);

builder.addDeclarativeElementSegment([grower.index, reader.index]);

builder.addFunction('main', kSig_i_v).addBody([
  kExprRefNull, cont_v_v,
  kExprRefFunc, reader.index,
  kExprContNew, cont_v_c,
  kExprResume, cont_v_c, 1,
    kOnSwitch, tag,
  kExprI32Const, 0,
]).exportFunc();

let instance = builder.instantiate();
let result = instance.exports.main();
if (result !== 0) throw new Error('unexpected result ' + result);
print('g=' + instance.exports.g.value);
print('OK');
