// C3/H14: WasmFX continuation stack external pointer across loop stack checks.
// Target source:
//   src/wasm/turboshaft-graph-interface.cc:3955-3973
//   CheckContAndGetStack() loads WasmStackObject::stack as an external pointer
//   and then reads raw StackMemory metadata.
//
// Success criterion:
//   Turboshaft trace shows the decoded stack pointer reused across
//   WasmStackCheck(loop), or ASan/release diverge under stack switching.
//
// Flags:
//   --experimental-wasm-wasmfx --allow-natives-syntax

d8.file.execute(
    "/Users/carlosgomez/v8-engagement/v8/v8/test/mjsunit/wasm/wasm-module-builder.js");

(function TestWasmFXStackPointerLoopStackCheck() {
  const builder = new WasmModuleBuilder();

  builder.startRecGroup();
  const cont_coro_idx = builder.nextTypeIndex() + 1;
  const sig_coro_idx =
      builder.addType(makeSig([kWasmI32, wasmRefType(cont_coro_idx)], [kWasmI32]));
  builder.addCont(sig_coro_idx);
  builder.endRecGroup();

  const tag_switch = builder.addTag(kSig_i_v);

  const coro = builder.addFunction("coro", sig_coro_idx)
      .addBody([
        kExprBlock, kWasmVoid,
          kExprLoop, kWasmVoid,
            kExprLocalGet, 0,
            kExprI32Eqz,
            kExprBrIf, 1,

            kExprLocalGet, 0,
            kExprI32Const, 1,
            kExprI32Sub,
            kExprLocalGet, 1,
            kExprSwitch, cont_coro_idx, tag_switch,

            kExprLocalSet, 1,
            kExprLocalSet, 0,
            kExprBr, 0,
          kExprEnd,
        kExprEnd,
        kExprLocalGet, 0,
      ]).exportFunc();

  builder.addFunction("main", kSig_i_v)
      .addBody([
        ...wasmI32Const(20000),
        kExprRefFunc, coro.index,
        kExprContNew, cont_coro_idx,
        kExprRefFunc, coro.index,
        kExprContNew, cont_coro_idx,
        kExprResume, cont_coro_idx, 1,
          kOnSwitch, tag_switch,
      ]).exportFunc();

  const instance = builder.instantiate();
  %ScheduleGCInStackCheck();
  const result = instance.exports.main();
  if (result !== 0) throw new Error("bad result: " + result);
  print("OK");
})();
