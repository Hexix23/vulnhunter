// C18 H4: control probe. VerifyFull must reject out-of-range constant pool IDs.
function c() {
  return "a";
}

c();
let bc = %GetBytecode(c);
let bytes = new Uint8Array(bc.bytecode);
print("bytecode", Array.from(bytes).join(","), "cp", bc.constant_pool.length);

// c bytecode:
//   LdaConstant [0]
//   Return
bytes[1] = 255;

print("install");
%InstallBytecode(c, bc);
print("unexpected-installed");
