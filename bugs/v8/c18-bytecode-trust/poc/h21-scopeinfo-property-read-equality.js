// C18 H21: consume H19 stored ScopeInfo via property reads/equality only.
var C18_H21_GLOBAL = 13;
function f() {
  return C18_H21_GLOBAL;
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
let arr = [r];
gc();

print("start");
let a = box.v;
let b = arr[0];
print("loaded");
print("same_field", a === box.v);
print("same_arr", b === arr[0]);
print("cross_same", a === b);
print("done");
