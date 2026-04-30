d8.file.execute('/Users/carlosgomez/v8-engagement/v8/v8/test/mjsunit/wasm/wasm-module-builder.js');

function checkEq(expected, actual, label) {
  if (expected !== actual) {
    throw new Error(label + ': expected ' + expected + ', got ' + actual);
  }
}

const kSig_i_ri = makeSig([kWasmExternRef, kWasmI32], [kWasmI32]);

const builder = new WasmModuleBuilder();
const codePointAt =
    builder.addImport('wasm:js-string', 'codePointAt', kSig_i_ri);
const trigger = builder.addImport('q', 'triggerStackCheck', kSig_v_v);

builder.addFunction('main', kSig_i_r)
  .exportFunc()
  .addLocals(kWasmI32, 2)  // local 1: first codepoint, local 2: loop counter.
  .addBody([
    kExprCallFunction, trigger,

    // first = codePointAt(s, 1)
    kExprLocalGet, 0,
    kExprI32Const, 1,
    kExprCallFunction, codePointAt,
    kExprLocalSet, 1,

    // Loop to trigger WasmStackCheck(kLoop).
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

    // second = codePointAt(s, 2)
    kExprLocalGet, 0,
    kExprI32Const, 2,
    kExprCallFunction, codePointAt,

    kExprLocalGet, 1,
    kExprI32Add,
  ]);

const imports = {
  q: {triggerStackCheck: () => %ScheduleGCInStackCheck()},
};
const builtins = {builtins: ['js-string']};
const instance = builder.instantiate(imports, builtins);

const sequential = 'abcdef';
checkEq(197, instance.exports.main(sequential), 'sequential string');

const external = 'abc' + 'def';
externalizeString(external);
checkEq(197, instance.exports.main(external), 'external string');

print('OK');
