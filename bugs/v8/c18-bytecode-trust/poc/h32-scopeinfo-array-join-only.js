// C18 H32: isolated Array.prototype.join over poisoned element.
var C18_H32_GLOBAL = 13;
function f() {
  return C18_H32_GLOBAL;
}

for (let i = 0; i < 1000; i++) f();

let bc = %GetBytecode(f);
let bytes = new Uint8Array(bc.bytecode);
for (let i = 0; i < bytes.length; i++) {
  if (bytes[i] === 0x23) bytes[i + 2] = 4;
}
%InstallBytecode(f, bc);

let r = f();
let arr = [r, 1, 2];
gc();

print("start");
print("join", arr.join("|"));
print("done");
