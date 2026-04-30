// C18 H28: Map/Set/WeakMap consumers for poisoned value.
var C18_H28_GLOBAL = 13;
function f() {
  return C18_H28_GLOBAL;
}

for (let i = 0; i < 1000; i++) f();

let bc = %GetBytecode(f);
let bytes = new Uint8Array(bc.bytecode);
for (let i = 0; i < bytes.length; i++) {
  if (bytes[i] === 0x23) bytes[i + 2] = 4;
}
%InstallBytecode(f, bc);

let r = f();
gc();

print("start");
let m = new Map();
m.set("k", r);
print("map-value", m.get("k") === r);
let s = new Set();
s.add(r);
print("set-has", s.has(r));
try {
  let wm = new WeakMap();
  wm.set(r, 1);
  print("weakmap-set-ok");
} catch (e) {
  print("weakmap-throw", e.name + ":" + e.message);
}
print("done");
