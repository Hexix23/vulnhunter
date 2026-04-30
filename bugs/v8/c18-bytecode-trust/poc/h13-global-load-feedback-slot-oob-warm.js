// C18 H13: global load FeedbackSlot OOB after feedback vector warmup.
var C18_GLOBAL_LOAD = 13;
function f() {
  return C18_GLOBAL_LOAD;
}

for (let i = 0; i < 1000; i++) f();
print("baseline", f());

let bc = %GetBytecode(f);
let bytes = new Uint8Array(bc.bytecode);
print("bytecode", Array.from(bytes).join(","));

// LdaGlobal [name], FBV[0]
for (let i = 0; i < bytes.length; i++) {
  if (bytes[i] === 0x23) {
    print("mutate-ldaglobal", i, bytes[i + 2], "->", 255);
    bytes[i + 2] = 255;
  }
}

print("install");
%InstallBytecode(f, bc);

print("run");
print(f());
