// C18 H11: named load FeedbackSlot OOB after feedback vector warmup.
function f(o) {
  return o.x;
}

let obj = {x: 13};
for (let i = 0; i < 1000; i++) f(obj);
print("baseline", f(obj));

let bc = %GetBytecode(f);
let bytes = new Uint8Array(bc.bytecode);
print("bytecode", Array.from(bytes).join(","));

// GetNamedProperty a0, [0:"x"], FBV[0]
for (let i = 0; i < bytes.length; i++) {
  if (bytes[i] === 0x33) {
    print("mutate-getnamed", i, bytes[i + 3], "->", 255);
    bytes[i + 3] = 255;
  }
}

print("install");
%InstallBytecode(f, bc);

print("run");
print(f(obj));
