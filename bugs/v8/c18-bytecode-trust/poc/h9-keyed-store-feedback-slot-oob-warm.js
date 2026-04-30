// C18 H9: keyed store FeedbackSlot OOB after feedback vector warmup.
function f(o, k, v) {
  o[k] = v;
  return o[k];
}

let obj = {};
for (let i = 0; i < 1000; i++) f(obj, "x", i);
print("baseline", f(obj, "x", 10));

let bc = %GetBytecode(f);
let bytes = new Uint8Array(bc.bytecode);
print("bytecode", Array.from(bytes).join(","));

// SetKeyedProperty a0, a1, FBV[0]
for (let i = 0; i < bytes.length; i++) {
  if (bytes[i] === 0x3c) {
    print("mutate-setkeyed", i, bytes[i + 3], "->", 255);
    bytes[i + 3] = 255;
  }
}

print("install");
%InstallBytecode(f, bc);

print("run");
print(f(obj, "x", 20));
