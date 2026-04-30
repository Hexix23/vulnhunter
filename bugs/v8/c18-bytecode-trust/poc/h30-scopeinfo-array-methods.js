// C18 H30: array methods over poisoned element.
var C18_H30_GLOBAL = 13;
function f() {
  return C18_H30_GLOBAL;
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
print("index", arr.indexOf(r));
print("map-len", arr.map(x => x).length);
print("filter-len", arr.filter(x => x === r).length);
print("slice-same", arr.slice(0, 1)[0] === r);
try {
  print("join", arr.join("|"));
} catch (e) {
  print("join-throw", e.name + ":" + e.message);
}
try {
  arr.sort();
  print("sort-ok", arr.length);
} catch (e) {
  print("sort-throw", e.name + ":" + e.message);
}
print("done");
