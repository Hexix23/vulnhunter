d8.file.execute('/Users/carlosgomez/v8-engagement/v8/v8/test/mjsunit/wasm/wasm-module-builder.js');

function checkEq(expected, actual, label) {
  if (expected !== actual) {
    throw new Error(label + ': expected 0x' + expected.toString(16) +
                    ', got 0x' + actual.toString(16));
  }
}

// C3b/H10: Wasm memory base is cached in InstanceCache. With movable growable
// memory and a stack-check-triggered GC, the post-stackcheck memory load must
// use the refreshed memory start, not a stale pre-GC base.
const builder = new WasmModuleBuilder();
const mem = builder.addMemory(1, 10000, false);
const trigger = builder.addImport('q', 'triggerStackCheck', kSig_v_v);

builder.addFunction('main', kSig_i_v)
  .exportFunc()
  .addLocals(kWasmI32, 1)
  .addBody([
    // memory[0] = 0x12345678
    kExprI32Const, 0,
    ...wasmI32Const(0x12345678),
    kExprI32StoreMem, 2, 0,

    // Schedule full GC on the next loop stack check. The import call itself
    // should reload cached memory; the interesting window is the stackcheck.
    kExprCallFunction, trigger,

    ...wasmI32Const(20000),
    kExprLocalSet, 0,
    kExprBlock, kWasmVoid,
      kExprLoop, kWasmVoid,
        kExprLocalGet, 0,
        kExprI32Eqz,
        kExprBrIf, 1,
        kExprLocalGet, 0,
        kExprI32Const, 1,
        kExprI32Sub,
        kExprLocalSet, 0,
        kExprBr, 0,
      kExprEnd,
    kExprEnd,

    // If mem_start was stale after a moving-GC stackcheck, this can read from
    // the old backing store.
    kExprI32Const, 0,
    kExprI32LoadMem, 2, 0,
  ]);

const instance = builder.instantiate({
  q: {triggerStackCheck: () => %ScheduleGCInStackCheck()},
});

checkEq(0x12345678, instance.exports.main(), 'movable wasm memory load');
print('OK');
