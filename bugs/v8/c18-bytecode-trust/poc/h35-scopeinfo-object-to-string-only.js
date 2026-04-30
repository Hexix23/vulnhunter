// C18 H35: isolated Object.prototype.toString over poisoned property.
var C18_H35_GLOBAL = 13;
function f() {
  return C18_H35_GLOBAL;
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
print("obj-to-string", Object.prototype.toString.call(box.v));
print("done");
