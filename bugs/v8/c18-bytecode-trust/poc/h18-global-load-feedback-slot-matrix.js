// C18 H18: parameterized LdaGlobal feedback slot matrix.
// Usage: d8 ... h18-global-load-feedback-slot-matrix.js -- <slot>
let targetSlot = 255;
try {
  if (typeof arguments !== "undefined" && arguments.length > 0) {
    targetSlot = Number(arguments[0]);
  }
} catch (_) {}

var C18_GLOBAL_MATRIX = 13;
function f() {
  return C18_GLOBAL_MATRIX;
}

for (let i = 0; i < 1000; i++) f();
let baseline = f();

let bc = %GetBytecode(f);
let bytes = new Uint8Array(bc.bytecode);

for (let i = 0; i < bytes.length; i++) {
  if (bytes[i] === 0x23) {
    bytes[i + 2] = targetSlot & 0xff;
  }
}

%InstallBytecode(f, bc);

let r = f();
let same = r === baseline;
let type = typeof r;
print(`slot=${targetSlot} baseline=${baseline} type=${type} same=${same}`);
try {
  %DebugPrint(r);
} catch (e) {
  print(`debugprint_throw=${e.name}:${e.message}`);
}
