// C18 H16: EmbeddedFeedback operands are not checked by VerifyFull.
function f(a, b) {
  return a < b;
}

for (let i = 0; i < 1000; i++) f(i, i + 1);
print("baseline", f(1, 2));

let bc = %GetBytecode(f);
let bytes = new Uint8Array(bc.bytecode);
print("bytecode", Array.from(bytes).join(","));

// TestLessThan a0, EmbeddedFeedback[0x0]
for (let i = 0; i < bytes.length; i++) {
  if (bytes[i] === 0x79) {
    print("mutate-embedded", i, bytes[i + 2], bytes[i + 3], "->", 255, 255);
    bytes[i + 2] = 255;
    bytes[i + 3] = 255;
  }
}

print("install");
%InstallBytecode(f, bc);

print("run");
print(f(3, 4));
