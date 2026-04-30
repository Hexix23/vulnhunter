// C18 H20: confirm H19's stored value with DebugPrint on containers.
var C18_GLOBAL_STORE_INTERNAL_DBG = 13;
function f() {
  return C18_GLOBAL_STORE_INTERNAL_DBG;
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

print("box-debug");
%DebugPrint(box);
print("arr-debug");
%DebugPrint(arr);
print("done");
