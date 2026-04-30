d8.file.execute('/Users/carlosgomez/v8-engagement/v8/v8/test/mjsunit/wasm/wasm-module-builder.js');

function checkEq(expected, actual, label) {
  if (expected !== actual) {
    throw new Error(label + ': expected ' + expected + ', got ' + actual);
  }
}

// C3b probe: force the same Wasm js-string.codePointAt access on both sides
// of a loop WasmStackCheck that processes a scheduled compacting GC.
const kSig_i_ri = makeSig([kWasmExternRef, kWasmI32], [kWasmI32]);

const builder = new WasmModuleBuilder();
const codePointAt =
    builder.addImport('wasm:js-string', 'codePointAt', kSig_i_ri);
const trigger = builder.addImport('q', 'triggerStackCheck', kSig_v_v);

builder.addFunction('main', kSig_i_r)
  .exportFunc()
  .addLocals(kWasmI32, 2)  // local 1: first result, local 2: loop counter.
  .addBody([
    kExprCallFunction, trigger,

    // first = codePointAt(s, 2)
    kExprLocalGet, 0,
    kExprI32Const, 2,
    kExprCallFunction, codePointAt,
    kExprLocalSet, 1,

    // Hot loop, intended to materialize WasmStackCheck(kLoop).
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

    // second = codePointAt(s, 2), same address class as the first access.
    kExprLocalGet, 0,
    kExprI32Const, 2,
    kExprCallFunction, codePointAt,

    kExprLocalGet, 1,
    kExprI32Add,
  ]);

const imports = {
  q: {triggerStackCheck: () => %ScheduleGCInStackCheck()},
};
const instance = builder.instantiate(imports, {builtins: ['js-string']});

const sequential = 'abcdef';
checkEq(198, instance.exports.main(sequential), 'sequential one-byte string');

const twoByte = 'ab\u0100def';
checkEq(512, instance.exports.main(twoByte), 'sequential two-byte string');

const external = 'abc' + 'def';
externalizeString(external);
checkEq(198, instance.exports.main(external), 'external one-byte string');

print('OK');
