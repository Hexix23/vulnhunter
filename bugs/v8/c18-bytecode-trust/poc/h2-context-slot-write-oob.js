// C18 H2: VerifyFull accepts out-of-range ContextSlot operands on stores.
function make() {
  let x = 13;
  return function inner() {
    return x;
  };
}

make();
let bc = %GetBytecode(make);
let bytes = new Uint8Array(bc.bytecode);
print("bytecode", Array.from(bytes).join(","));

// make bytecode has two StaCurrentContextSlotNoCell [2] operands:
//   slot init to the hole, then slot write to 13.
bytes[7] = 255;
bytes[11] = 255;

print("install");
%InstallBytecode(make, bc);

print("run");
let f = make();
print(f());
