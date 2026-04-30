// C21 H15: lifecycle after extension transplant alias and second transfer.
//
// Checks whether the first transferred buffer remains attached to the same
// backing store after b.transfer(), and whether GC leaves a dangling view.

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
let vb = new Uint8Array(b);
vb[0] = 0x42;
vb[1] = 0x43;

setField(getPtr(a), kJSArrayBufferExtensionOffset,
         getField(getPtr(b), kJSArrayBufferExtensionOffset));

let t1 = a.transfer();
let vt1 = new Uint8Array(t1);
vt1[1] = 0x99;

let t2 = b.transfer();
let vt2 = new Uint8Array(t2);

print(`after_second=${t1.byteLength}:${t2.byteLength}:${vt1[0]}:${vt1[1]}:${vt2[0]}:${vt2[1]}`);

vt2[2] = 0x55;
print(`alias_t2_to_t1=${vt1[2]}:${vt2[2]}`);

vt1[3] = 0x66;
print(`alias_t1_to_t2=${vt1[3]}:${vt2[3]}`);

gc();
print(`post_gc=${vt1[0]}:${vt1[1]}:${vt1[2]}:${vt1[3]}:${vt2[0]}:${vt2[1]}:${vt2[2]}:${vt2[3]}`);
