// C18 H19: take H18's ScopeInfo result and store it before inspecting it.
// Goal: see whether an internal object returned by LdaGlobal FBV[4] can be
// written into normal JS object/array fields and survive GC.
var C18_GLOBAL_STORE_INTERNAL = 13;
function f() {
  return C18_GLOBAL_STORE_INTERNAL;
}

for (let i = 0; i < 1000; i++) f();
print("baseline", f());

let bc = %GetBytecode(f);
let bytes = new Uint8Array(bc.bytecode);
for (let i = 0; i < bytes.length; i++) {
  if (bytes[i] === 0x23) bytes[i + 2] = 4;
}
%InstallBytecode(f, bc);

print("call");
let r = f();
print("returned");

let box = {};
let arr = [];
box.v = r;
arr[0] = r;
print("stored");

gc();
print("gc1-ok");

// Avoid printing r directly. Only test whether field loads complete.
let a = box.v;
let b = arr[0];
print("loaded");

gc();
print("gc2-ok");
