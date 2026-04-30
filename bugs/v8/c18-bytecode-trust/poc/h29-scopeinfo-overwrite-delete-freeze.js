// C18 H29: overwrite/delete/freeze/seal after storing poisoned property.
var C18_H29_GLOBAL = 13;
function f() {
  return C18_H29_GLOBAL;
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
print("before", box.v === r);
delete box.v;
print("deleted", !Object.hasOwn(box, "v"));
box.v = 42;
print("overwritten", box.v);
Object.freeze(box);
print("frozen", Object.isFrozen(box));
let sealed = {v: r};
Object.seal(sealed);
print("sealed", Object.isSealed(sealed), sealed.v === r);
gc();
print("done");
