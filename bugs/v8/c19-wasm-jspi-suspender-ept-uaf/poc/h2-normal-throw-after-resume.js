// C19 H2: normal JS exception after JSPI resume.
// Goal: same cross-stack unwind shape as regress-501147587, but using a
// regular imported thrower instead of %TerminateExecution().

d8.file.execute('test/mjsunit/wasm/wasm-module-builder.js');
d8.file.execute('test/mjsunit/sandbox/wasm-jspi.js');

let builder = new WasmModuleBuilder();
let resolve_p;
let p = new Promise(r => resolve_p = r);
let suspending = new WebAssembly.Suspending(() => p);
let suspend_idx = builder.addImport("m", "suspend", kSig_v_v);
let thrower = () => { throw new Error("h2-boom"); };
let throw_idx = builder.addImport("m", "thrower", kSig_v_v);

builder.addFunction("main", kSig_v_v)
  .addBody([
    kExprCallFunction, suspend_idx,
    kExprCallFunction, throw_idx,
  ]).exportFunc();

let instance = builder.instantiate({m: {suspend: suspending, thrower}});
let promising = WebAssembly.promising(instance.exports.main);

promising().catch(e => print("[*] promising rejected: " + e.message));
let resume_data = get_resume_data(p);
let resume_cb = Sandbox.getObjectAt(
    getField(getField(getPtr(p), kJSPromiseReactionsOrResultOffset),
             kPromiseReactionFulfillHandlerOffset));
print("[*] suspender handle: 0x" + get_suspender(resume_data).toString(16));

setTimeout(() => {
  print("[*] post-throw: handle still 0x" + get_suspender(resume_data).toString(16));
  gc({type:'major', execution:'sync', flavor:'last-resort'});
  print("[*] manual second resume after throw unwind");
  resume_cb(undefined);
  print("[!] no violation");
}, 0);

print("[*] resolving -> thrower");
resolve_p();
