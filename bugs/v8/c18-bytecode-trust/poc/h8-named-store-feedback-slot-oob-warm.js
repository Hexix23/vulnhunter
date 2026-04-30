// C18 H8: named store FeedbackSlot OOB after feedback vector warmup.
function f(o, v) {
  o.x = v;
  return o.x;
}

let obj = {};
for (let i = 0; i < 1000; i++) f(obj, i);
print("baseline", f(obj, 10));

let bc = %GetBytecode(f);
let bytes = new Uint8Array(bc.bytecode);
print("bytecode", Array.from(bytes).join(","));

// SetNamedProperty a0, [0:"x"], FBV[0]
for (let i = 0; i < bytes.length; i++) {
  if (bytes[i] === 0x3a) {
    print("mutate-setnamed", i, bytes[i + 3], "->", 255);
    bytes[i + 3] = 255;
  }
}

print("install");
%InstallBytecode(f, bc);

print("run");
print(f(obj, 20));
