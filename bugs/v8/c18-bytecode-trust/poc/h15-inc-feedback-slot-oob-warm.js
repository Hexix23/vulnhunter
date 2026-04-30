// C18 H15: Inc FeedbackSlot OOB after feedback vector warmup.
function f(o) {
  return ++o.x;
}

let obj = {x: 0};
for (let i = 0; i < 1000; i++) f(obj);
print("baseline", f(obj));

let bc = %GetBytecode(f);
let bytes = new Uint8Array(bc.bytecode);
print("bytecode", Array.from(bytes).join(","));

// Inc FBV[2]
for (let i = 0; i < bytes.length; i++) {
  if (bytes[i] === 0x5b) {
    print("mutate-inc", i, bytes[i + 1], "->", 255);
    bytes[i + 1] = 255;
  }
}

print("install");
%InstallBytecode(f, bc);

print("run");
print(f(obj));
