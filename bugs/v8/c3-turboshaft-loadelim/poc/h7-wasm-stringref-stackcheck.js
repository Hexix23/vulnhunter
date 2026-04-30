d8.file.execute('/Users/carlosgomez/v8-engagement/v8/v8/test/mjsunit/wasm/wasm-module-builder.js');

function checkEq(expected, actual, label) {
  if (expected !== actual) {
    throw new Error(label + ': expected ' + expected + ', got ' + actual);
  }
}

const kSig_i_w = makeSig([kWasmStringRef], [kWasmI32]);

const builder = new WasmModuleBuilder();
const trigger = builder.addImport('q', 'triggerStackCheck', kSig_v_v);

builder.addFunction('main', kSig_i_w)
  .exportFunc()
  .addLocals(kWasmI32, 2)  // local 1: first codeunit, local 2: loop counter.
  .addBody([
    // Schedule a full GC for the next loop stack check before the first
    // string character access.
    kExprCallFunction, trigger,

    // first = string.as_wtf16(s).get_codeunit(1)
    kExprLocalGet, 0,
    ...GCInstr(kExprStringAsWtf16),
    kExprI32Const, 1,
    ...GCInstr(kExprStringViewWtf16GetCodeunit),
    kExprLocalSet, 1,

    // Spin long enough to execute a Wasm loop stack check.
    ...wasmI32Const(20000),
    kExprLocalSet, 2,
    kExprBlock, kWasmVoid,
      kExprLoop, kWasmVoid,
        kExprLocalGet, 2,
        kExprI32Eqz,
        kExprBrIf, 1,
        kExprLocalGet, 2,
        kExprI32Const, 1,
        kExprI32Sub,
        kExprLocalSet, 2,
        kExprBr, 0,
      kExprEnd,
    kExprEnd,

    // second = string.as_wtf16(s).get_codeunit(2)
    kExprLocalGet, 0,
    ...GCInstr(kExprStringAsWtf16),
    kExprI32Const, 2,
    ...GCInstr(kExprStringViewWtf16GetCodeunit),

    // return first + second
    kExprLocalGet, 1,
    kExprI32Add,
  ]);

const instance = builder.instantiate({
  q: {triggerStackCheck: () => %ScheduleGCInStackCheck()}
});

const sequential = 'abcdef';
checkEq(197, instance.exports.main(sequential), 'sequential string');

const external = 'abc' + 'def';
externalizeString(external);
checkEq(197, instance.exports.main(external), 'external string');

print('OK');
