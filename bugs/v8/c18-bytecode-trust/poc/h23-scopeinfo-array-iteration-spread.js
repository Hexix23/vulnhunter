// C18 H23: consume H19 stored ScopeInfo via array iteration/spread.
var C18_H23_GLOBAL = 13;
function f() {
  return C18_H23_GLOBAL;
}

for (let i = 0; i < 1000; i++) f();

let bc = %GetBytecode(f);
let bytes = new Uint8Array(bc.bytecode);
for (let i = 0; i < bytes.length; i++) {
  if (bytes[i] === 0x23) bytes[i + 2] = 4;
}
%InstallBytecode(f, bc);

let r = f();
let arr = [r];
gc();

print("start");
let count = 0;
for (let x of arr) {
  count++;
}
print("iter-count", count);
try {
  let copy = [...arr];
  print("spread-len", copy.length);
} catch (e) {
  print("spread-throw", e.name + ":" + e.message);
}
try {
  print("includes", arr.includes(arr[0]));
} catch (e) {
  print("includes-throw", e.name + ":" + e.message);
}
print("done");
