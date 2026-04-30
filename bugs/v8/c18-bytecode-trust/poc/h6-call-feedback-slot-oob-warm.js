// C18 H6: FeedbackSlot operands are not checked by VerifyFull.
// This warms a property-call IC, mutates the call feedback slot, then runs.
function f(o, x) {
  return o.m(x, 1);
}

let obj = { m(a, b) { return a + b; } };
for (let i = 0; i < 1000; i++) f(obj, i);
print("baseline", f(obj, 10));

let bc = %GetBytecode(f);
let bytes = new Uint8Array(bc.bytecode);
print("bytecode", Array.from(bytes).join(","));

// Mutate CallProperty* feedback operands. In the common shape:
//   CallProperty2 r0, r1, a1, rN, FBV[slot]
for (let i = 0; i < bytes.length; i++) {
  if (bytes[i] === 0x6a || bytes[i] === 0x69 || bytes[i] === 0x68) {
    print("mutate-call", i, bytes[i + 5], "->", 255);
    bytes[i + 5] = 255;
  }
}

print("install");
%InstallBytecode(f, bc);

print("run");
print(f(obj, 20));
