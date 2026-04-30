// C21 H13: JSArrayBuffer.extension ExternalPointer handle transplant.
//
// backing_store is a SandboxedPtr (H12: in-sandbox only). extension is an
// ExternalPointer handle to ArrayBufferExtension/BackingStore metadata outside
// the sandbox. This tests whether copying a same-tag extension handle between
// ArrayBuffers creates a lifecycle confusion when transfer/detach consumes it.

const kHeapObjectTag = 1;
const kJSArrayBufferExtensionOffset = 0x2c;

const memory = new DataView(new Sandbox.MemoryView(0, 0x100000000));

function getPtr(obj) {
  return Sandbox.getAddressOf(obj) + kHeapObjectTag;
}

function getField(obj, offset) {
  return memory.getUint32(obj + offset - kHeapObjectTag, true);
}

function setField(obj, offset, value) {
  memory.setUint32(obj + offset - kHeapObjectTag, value, true);
}

let a = new ArrayBuffer(16);
let b = new ArrayBuffer(16);
let va = new Uint8Array(a);
let vb = new Uint8Array(b);
va[0] = 0x11;
vb[0] = 0x42;

let aExt = getField(getPtr(a), kJSArrayBufferExtensionOffset);
let bExt = getField(getPtr(b), kJSArrayBufferExtensionOffset);

print(`a_ext=0x${aExt.toString(16)}`);
print(`b_ext=0x${bExt.toString(16)}`);
print(`before=${a.byteLength}:${b.byteLength}:${va[0]}:${vb[0]}`);

setField(getPtr(a), kJSArrayBufferExtensionOffset, bExt);

let transferred;
try {
  transferred = a.transfer();
  print(`transfer_ok=${transferred.byteLength}:${new Uint8Array(transferred)[0]}`);
} catch (e) {
  print(`transfer_throw=${e.name}:${e.message}`);
}

try {
  print(`after_b=${b.byteLength}:${vb[0]}`);
} catch (e) {
  print(`after_b_throw=${e.name}:${e.message}`);
}

gc();

try {
  print(`post_gc_b=${b.byteLength}:${vb[0]}`);
} catch (e) {
  print(`post_gc_b_throw=${e.name}:${e.message}`);
}
