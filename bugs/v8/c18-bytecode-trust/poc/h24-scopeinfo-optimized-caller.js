// C18 H24: pass H18 internal value through a warmed/optimized caller.
var C18_H24_GLOBAL = 13;
function f() {
  return C18_H24_GLOBAL;
}

function makeBox() {
  return {v: f()};
}

for (let i = 0; i < 1000; i++) f();

let bc = %GetBytecode(f);
let bytes = new Uint8Array(bc.bytecode);
for (let i = 0; i < bytes.length; i++) {
  if (bytes[i] === 0x23) bytes[i + 2] = 4;
}
%InstallBytecode(f, bc);

for (let i = 0; i < 10000; i++) {
  let b = makeBox();
  if (i === 0) print("first");
}

%PrepareFunctionForOptimization(makeBox);
makeBox();
makeBox();
%OptimizeFunctionOnNextCall(makeBox);
let box = makeBox();
print("optimized-box");
gc();
let v = box.v;
print("loaded");
print("done");
