// C18 H22: consume H19 stored ScopeInfo via string/JSON conversion.
var C18_H22_GLOBAL = 13;
function f() {
  return C18_H22_GLOBAL;
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
try {
  print("json-box", JSON.stringify(box));
} catch (e) {
  print("json-box-throw", e.name + ":" + e.message);
}
try {
  print("json-arr", JSON.stringify(arr));
} catch (e) {
  print("json-arr-throw", e.name + ":" + e.message);
}
try {
  print("string", String(box.v));
} catch (e) {
  print("string-throw", e.name + ":" + e.message);
}
print("done");
