// Minimal raw-byte repro for C7-H9. Requires:
//   --experimental-wasm-custom-descriptors --experimental-wasm-shared
//
// Expected: either clean CompileError if unsupported, or successful execution.
// Actual: release d8 aborts with Fatal error: unimplemented code.

const bytes = new Uint8Array([
  0,97,115,109,1,0,0,0,1,31,3,78,2,80,0,101,77,1,95,1,
  127,1,80,0,101,76,0,95,0,96,1,127,1,100,0,96,1,100,0,
  1,127,3,3,2,2,3,7,15,2,4,109,97,107,101,0,0,4,114,
  101,97,100,0,1,10,21,2,10,0,32,0,251,1,1,251,32,0,
  11,8,0,32,0,251,2,0,0,11,0,20,4,110,97,109,101,1,
  13,2,0,4,109,97,107,101,1,4,114,101,97,100
]);

const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes));
const obj = instance.exports.make(4321);
const got = instance.exports.read(obj);
if (got !== 4321) throw new Error("bad read: " + got);
print("OK");
