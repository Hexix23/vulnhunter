// C21 H9: WeakRef liveness check for forged pointer hidden in i64 bytes.
//
// If WeakRef is cleared but global.value still recovers a usable object, the
// hidden numeric bytes are giving stale/reused object access. If WeakRef stays
// alive, the object is still rooted somewhere and this case is less useful.

d8.file.execute('test/mjsunit/wasm/wasm-module-builder.js');

const kHeapObjectTag = 1;
const kExternRefRawTypeSmi = 0x160a;
const kind = globalThis.H9_KIND || 'typedarray';

function makeTarget(kind) {
  switch (kind) {
    case 'object':
      return {tag: 'weak-object', marker: 0x901};
    case 'typedarray':
      return new Uint32Array([0x901, 0x902, 0x903]);
    case 'arraybuffer':
      return new ArrayBuffer(128);
    default:
      throw new Error(`unknown kind ${kind}`);
  }
}

function observe(kind, value) {
  if (value == null) return `${value}`;
  try {
    if (kind === 'object') return `${value.tag}:${value.marker}`;
    if (kind === 'typedarray') return `${value.length}:${value[0]}:${value[2]}`;
    if (kind === 'arraybuffer') return `${value.byteLength}`;
  } catch (e) {
    return `THREW:${e.name}:${e.message}`;
  }
}

let builder = new WasmModuleBuilder();
builder.addGlobal(kWasmI64, true, false, [kExprI64Const, 0]).exportAs('g');
let global = builder.instantiate().exports.g;

let weak;
(function() {
  let target = makeTarget(kind);
  weak = new WeakRef(target);
  print(`kind=${kind}`);
  print(`before=${observe(kind, target)}`);
  global.value = BigInt(Sandbox.getAddressOf(target) + kHeapObjectTag);
})();

Sandbox.corruptObjectField(global, 'raw_type', kExternRefRawTypeSmi);

for (let r = 0; r < 20; r++) {
  let junk = [];
  for (let i = 0; i < 50000; i++) junk.push({i, a: i ^ 0x9999});
  gc();
}

let weakValue = weak.deref();
print(`weak=${observe(kind, weakValue)}`);

let recovered = global.value;
print(`recovered=${observe(kind, recovered)}`);

if (kind === 'typedarray' && recovered) {
  recovered[1] = 0xdead;
  print(`writeback=${recovered[1]}`);
}
