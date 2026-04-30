// C20 H6: cross-isolate shared memory grow must refresh WasmTrustedInstanceData
// before compiled Wasm atomic memory sinks use the newly grown page.
//
// Shape:
// - worker runs a Wasm loop using memory.size until main grows shared memory;
// - loop backedge stack guard should process GROW_SHARED_MEMORY;
// - same Wasm activation then atomic-stores/loads at old_size page boundary.

d8.file.execute('test/mjsunit/wasm/wasm-module-builder.js');

const kPage = 65536;
const kInitialPages = 1;
const kFinalPages = 2;
const kSyncIndex = 64;
const kSyncValue = 0x51515151;
const kSinkAddress = kInitialPages * kPage;
const kSinkValue = 0x41424344;

let memory = new WebAssembly.Memory({
  initial: kInitialPages,
  maximum: 5,
  shared: true,
});

let builder = new WasmModuleBuilder();
builder.addImportedMemory('m', 'mem', kInitialPages, 5, true);

builder.addFunction('main', kSig_i_v)
  .addLocals(kWasmI32, 1)
  .addBody([
    // while (memory.size == 1) {
    //   atomic.store(sync_index, sync_value);
    // }
    kExprLoop, kWasmVoid,
      ...wasmI32Const(kSyncIndex),
      ...wasmI32Const(kSyncValue),
      kAtomicPrefix, kExprI32AtomicStore, 2, 0,
      kExprMemorySize, kMemoryZero,
      kExprLocalTee, 0,
      ...wasmI32Const(kInitialPages),
      kExprI32Eq,
      kExprBrIf, 0,
    kExprEnd,

    // Sink: explicit atomic bounds path at the first byte of the new page.
    ...wasmI32Const(kSinkAddress),
    ...wasmI32Const(kSinkValue),
    kAtomicPrefix, kExprI32AtomicStore, 2, 0,
    ...wasmI32Const(kSinkAddress),
    kAtomicPrefix, kExprI32AtomicLoad, 2, 0,
  ])
  .exportFunc();

builder.addFunction('getter', kSig_i_i)
  .addBody([
    kExprLocalGet, 0,
    kAtomicPrefix, kExprI32AtomicLoad, 2, 0,
  ])
  .exportFunc();

let module = new WebAssembly.Module(builder.toBuffer());
let instance = new WebAssembly.Instance(module, {m: {mem: memory}});

function workerCode() {
  onmessage = function({data}) {
    try {
      let instance = new WebAssembly.Instance(data.module, {m: {mem: data.memory}});
      postMessage({ok: true, result: instance.exports.main()});
    } catch (e) {
      postMessage({ok: false, error: String(e), stack: e && e.stack});
    }
  };
}

let worker = new Worker(workerCode, {type: 'function'});
worker.postMessage({module, memory});

// Wait until worker is executing inside the Wasm loop.
while (instance.exports.getter(kSyncIndex) !== kSyncValue) {}

let oldPages = memory.grow(kFinalPages - kInitialPages);
if (oldPages !== kInitialPages) {
  throw new Error(`unexpected old page count ${oldPages}`);
}

let msg = worker.getMessage();
if (!msg.ok) {
  throw new Error(`worker trap/error: ${msg.error}\n${msg.stack || ''}`);
}
if (msg.result !== kSinkValue) {
  throw new Error(`sink mismatch: got 0x${msg.result.toString(16)}`);
}

let view = new Int32Array(memory.buffer);
if (view[kSinkAddress >> 2] !== kSinkValue) {
  throw new Error(`main could not observe sink write`);
}

print('OK');
