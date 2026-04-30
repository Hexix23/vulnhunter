// C18 H25: store many H18 internal values and stress GC/marking.
var C18_H25_GLOBAL = 13;
function f() {
  return C18_H25_GLOBAL;
}

for (let i = 0; i < 1000; i++) f();

let bc = %GetBytecode(f);
let bytes = new Uint8Array(bc.bytecode);
for (let i = 0; i < bytes.length; i++) {
  if (bytes[i] === 0x23) bytes[i + 2] = 4;
}
%InstallBytecode(f, bc);

let keep = [];
print("start");
for (let i = 0; i < 10000; i++) {
  let r = f();
  keep.push({v: r, i});
  keep.push([r, i]);
  if ((i & 255) === 0) gc();
}
print("stored", keep.length);
gc();
print("gc-ok");
let sum = 0;
for (let i = 1; i < keep.length; i += 2) {
  sum += keep[i][1];
}
print("sum", sum);
