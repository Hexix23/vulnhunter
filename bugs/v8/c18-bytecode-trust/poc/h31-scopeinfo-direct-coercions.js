// C18 H31: direct JS type/coercion consumers for poisoned value.
var C18_H31_GLOBAL = 13;
function f() {
  return C18_H31_GLOBAL;
}

for (let i = 0; i < 1000; i++) f();

let bc = %GetBytecode(f);
let bytes = new Uint8Array(bc.bytecode);
for (let i = 0; i < bytes.length; i++) {
  if (bytes[i] === 0x23) bytes[i + 2] = 4;
}
%InstallBytecode(f, bc);

let r = f();
let box = {v: r};
gc();

print("start");
try {
  print("typeof", typeof box.v);
} catch (e) {
  print("typeof-throw", e.name + ":" + e.message);
}
try {
  print("string", String(box.v));
} catch (e) {
  print("string-throw", e.name + ":" + e.message);
}
try {
  print("obj-to-string", Object.prototype.toString.call(box.v));
} catch (e) {
  print("obj-to-string-throw", e.name + ":" + e.message);
}
try {
  print("bool", Boolean(box.v));
} catch (e) {
  print("bool-throw", e.name + ":" + e.message);
}
print("done");
