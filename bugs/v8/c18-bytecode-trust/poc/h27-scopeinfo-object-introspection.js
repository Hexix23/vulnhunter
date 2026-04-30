// C18 H27: object meta-operations over poisoned property.
var C18_H27_GLOBAL = 13;
function f() {
  return C18_H27_GLOBAL;
}

for (let i = 0; i < 1000; i++) f();

let bc = %GetBytecode(f);
let bytes = new Uint8Array(bc.bytecode);
for (let i = 0; i < bytes.length; i++) {
  if (bytes[i] === 0x23) bytes[i + 2] = 4;
}
%InstallBytecode(f, bc);

let r = f();
let box = {v: r, ok: 1};
gc();

print("start");
print("keys", Object.keys(box).join(","));
print("values-len", Object.values(box).length);
print("entries-len", Object.entries(box).length);
let d = Object.getOwnPropertyDescriptor(box, "v");
print("descriptor", d.enumerable, d.value === box.v);
print("has-own", Object.hasOwn(box, "v"));
print("done");
