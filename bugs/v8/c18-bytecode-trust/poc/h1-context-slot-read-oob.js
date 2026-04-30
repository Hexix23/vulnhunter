// C18 H1: VerifyFull accepts an out-of-range ContextSlot operand.
// The interpreter then reads the mutated context slot.
function make() {
  let x = 13;
  return function inner() {
    return x;
  };
}

let f = make();
print("baseline", f());

let bc = %GetBytecode(f);
let bytes = new Uint8Array(bc.bytecode);
print("bytecode", Array.from(bytes).join(","));

// inner bytecode:
//   0: LdaImmutableCurrentContextSlot [2]
//   2: ThrowReferenceErrorIfHole [0]
//   4: Return
bytes[1] = 255;

print("install");
%InstallBytecode(f, bc);

print("run");
print(f());
