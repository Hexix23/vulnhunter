// C21 H16: invalid JSArrayBuffer.extension handle.
//
// Tests ExternalPointerTable guard behavior for ArrayBufferExtension handles.

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

let mode = globalThis.H16_MODE || 'plus4';
let a = new ArrayBuffer(16);
let u = new Uint8Array(a);
u[0] = 0x41;

let ext = getField(getPtr(a), kJSArrayBufferExtensionOffset);
let corrupt =
    mode === 'zero' ? 0 :
    mode === 'ffff' ? 0xffffffff :
    mode === 'plus4' ? (ext + 4) >>> 0 :
    mode === 'xor' ? (ext ^ 0x100) >>> 0 :
    ext;

print(`mode=${mode}`);
print(`ext=0x${ext.toString(16)}`);
print(`corrupt=0x${corrupt.toString(16)}`);
setField(getPtr(a), kJSArrayBufferExtensionOffset, corrupt);

try {
  let t = a.transfer();
  print(`transfer=${t.byteLength}:${new Uint8Array(t)[0]}`);
} catch (e) {
  print(`throw=${e.name}:${e.message}`);
}

gc();
print('done');
