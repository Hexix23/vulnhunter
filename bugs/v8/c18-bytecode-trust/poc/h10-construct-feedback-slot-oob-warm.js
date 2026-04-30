// C18 H10: Construct FeedbackSlot OOB after feedback vector warmup.
function C(x) {
  this.x = x;
}

function f(x) {
  return new C(x);
}

for (let i = 0; i < 1000; i++) f(i);
print("baseline", f(10).x);

let bc = %GetBytecode(f);
let bytes = new Uint8Array(bc.bytecode);
print("bytecode", Array.from(bytes).join(","));

// Construct r0, a0-a0, FBV[2]
for (let i = 0; i < bytes.length; i++) {
  if (bytes[i] === 0x74) {
    print("mutate-construct", i, bytes[i + 4], "->", 255);
    bytes[i + 4] = 255;
  }
}

print("install");
%InstallBytecode(f, bc);

print("run");
print(f(20).x);
