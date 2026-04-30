// C18 H26: copy poisoned property through Object.assign and object spread.
var C18_H26_GLOBAL = 13;
function f() {
  return C18_H26_GLOBAL;
}

for (let i = 0; i < 1000; i++) f();

let bc = %GetBytecode(f);
let bytes = new Uint8Array(bc.bytecode);
for (let i = 0; i < bytes.length; i++) {
  if (bytes[i] === 0x23) bytes[i + 2] = 4;
}
%InstallBytecode(f, bc);

let r = f();
let box = {v: r, ok: 1};
gc();

print("start");
let a = Object.assign({}, box);
print("assign-ok", a.ok, a.v === box.v);
let b = {...box};
print("spread-ok", b.ok, b.v === box.v);
gc();
print("done");
