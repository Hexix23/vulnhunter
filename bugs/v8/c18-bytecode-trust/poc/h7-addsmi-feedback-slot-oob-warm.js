// C18 H7: arithmetic feedback slot OOB after feedback vector is warm.
function f(x) {
  return x + 1;
}

for (let i = 0; i < 1000; i++) f(i);
print("baseline", f(10));

let bc = %GetBytecode(f);
let bytes = new Uint8Array(bc.bytecode);
print("bytecode", Array.from(bytes).join(","));

// Common compact bytecode is AddSmi [1], FBV[slot].
// Mutate the last operand of AddSmi/SubSmi/MulSmi/... if present.
for (let i = 0; i < bytes.length; i++) {
  if (bytes[i] >= 0x4f && bytes[i] <= 0x5a) {
    print("mutate-arith", i, bytes[i + 2], "->", 255);
    bytes[i + 2] = 255;
  }
}

print("install");
%InstallBytecode(f, bc);

print("run");
print(f(20));
