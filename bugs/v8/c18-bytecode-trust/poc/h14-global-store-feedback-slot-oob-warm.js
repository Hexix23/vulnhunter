// C18 H14: global store FeedbackSlot OOB after feedback vector warmup.
var C18_GLOBAL_STORE = 0;
function f(v) {
  C18_GLOBAL_STORE = v;
  return C18_GLOBAL_STORE;
}

for (let i = 0; i < 1000; i++) f(i);
print("baseline", f(13));

let bc = %GetBytecode(f);
let bytes = new Uint8Array(bc.bytecode);
print("bytecode", Array.from(bytes).join(","));

// StaGlobal [name], FBV[0]
for (let i = 0; i < bytes.length; i++) {
  if (bytes[i] === 0x25) {
    print("mutate-staglobal", i, bytes[i + 2], "->", 255);
    bytes[i + 2] = 255;
  }
}

print("install");
%InstallBytecode(f, bc);

print("run");
print(f(20));
