// C18 H36: isolated Boolean() over poisoned property.
var C18_H36_GLOBAL = 13;
function f() {
  return C18_H36_GLOBAL;
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
print("bool", Boolean(box.v));
print("done");
