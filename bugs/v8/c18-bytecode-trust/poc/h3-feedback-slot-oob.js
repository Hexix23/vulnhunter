// C18 H3: FeedbackSlot operands are not checked by VerifyFull.
// This first probe checks whether a high slot is observable in a named load.
function h(o) {
  return o.x;
}

h({x: 1});
let bc = %GetBytecode(h);
let bytes = new Uint8Array(bc.bytecode);
print("bytecode", Array.from(bytes).join(","));

// h bytecode:
//   GetNamedProperty a0, [0:"x"], FBV[0]
// Mutate the single-byte feedback slot to 255.
for (let i = 0; i < bytes.length; i++) {
  if (bytes[i] === 0x33) bytes[i + 3] = 255;
}

print("install");
%InstallBytecode(h, bc);

print("run");
print(h({x: 2}));
