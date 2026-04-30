// C18 H12: keyed load FeedbackSlot OOB after feedback vector warmup.
function f(o, k) {
  return o[k];
}

let obj = {x: 13};
for (let i = 0; i < 1000; i++) f(obj, "x");
print("baseline", f(obj, "x"));

let bc = %GetBytecode(f);
let bytes = new Uint8Array(bc.bytecode);
print("bytecode", Array.from(bytes).join(","));

// GetKeyedProperty a0, FBV[0]
for (let i = 0; i < bytes.length; i++) {
  if (bytes[i] === 0x35) {
    print("mutate-getkeyed", i, bytes[i + 2], "->", 255);
    bytes[i + 2] = 255;
  }
}

print("install");
%InstallBytecode(f, bc);

print("run");
print(f(obj, "x"));
