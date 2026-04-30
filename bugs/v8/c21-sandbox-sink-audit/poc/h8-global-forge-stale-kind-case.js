// C21 H8: stale forged-reference one-kind case.
//
// Usage:
//   d8 ... -e "var H8_KIND='object'" h8-global-forge-stale-kind-case.js
//
// One process per kind, because stale failures can crash the process.

d8.file.execute('test/mjsunit/wasm/wasm-module-builder.js');

const kHeapObjectTag = 1;
const kExternRefRawTypeSmi = 0x160a;
const kind = globalThis.H8_KIND || 'object';

function makeTarget(kind) {
  switch (kind) {
    case 'object':
      return {tag: 'stale-object', marker: 0x101};
    case 'array':
      return [1, 2, 3, 4];
    case 'function':
      return function staleFunction() { return 0x202; };
    case 'arraybuffer':
      return new ArrayBuffer(64);
    case 'typedarray':
      return new Uint32Array([0x303, 0x404]);
    case 'stringobject':
      return new String('stale-string');
    default:
      throw new Error(`unknown kind ${kind}`);
  }
}

function observe(value) {
  if (value == null) return `${value}`;
  try {
    if (kind === 'object') return `${value.tag}:${value.marker}`;
    if (kind === 'array') return `${Array.isArray(value)}:${value.length}:${value[1]}`;
    if (kind === 'function') return `${typeof value}:${value()}`;
    if (kind === 'arraybuffer') return `${value.byteLength}`;
    if (kind === 'typedarray') return `${value.length}:${value[0]}`;
    if (kind === 'stringobject') return `${value.valueOf()}:${value.length}`;
  } catch (e) {
    return `THREW:${e.name}:${e.message}`;
  }
}

let builder = new WasmModuleBuilder();
builder.addGlobal(kWasmI64, true, false, [kExprI64Const, 0]).exportAs('g');
let global = builder.instantiate().exports.g;

(function() {
  let target = makeTarget(kind);
  print(`kind=${kind}`);
  print(`before=${observe(target)}`);
  global.value = BigInt(Sandbox.getAddressOf(target) + kHeapObjectTag);
})();

Sandbox.corruptObjectField(global, 'raw_type', kExternRefRawTypeSmi);

for (let r = 0; r < 10; r++) {
  let junk = [];
  for (let i = 0; i < 20000; i++) junk.push({i, a: i ^ 0x7777});
  gc();
}

let recovered = global.value;
print(`after=${observe(recovered)}`);
