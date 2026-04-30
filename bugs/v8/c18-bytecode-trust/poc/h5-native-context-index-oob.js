// C18 H5: VerifyFull accepts an out-of-range NativeContextIndex operand.
// Direct eval with non-final spread generates CallJSRuntime [reflect_apply].
function f(args) {
  return eval(...args);
}

print("baseline", f(["1+2"]));

let bc = %GetBytecode(f);
let bytes = new Uint8Array(bc.bytecode);
print("bytecode", Array.from(bytes).join(","));

// Expected tail:
//   CallJSRuntime [reflect_apply], r2-r4
// Mutate the NativeContextIndex operand from reflect_apply to 255.
for (let i = 0; i < bytes.length; i++) {
  if (bytes[i] === 0x72) {
    print("mutate", i, bytes[i + 1], "->", 255);
    bytes[i + 1] = 255;
  }
}

print("install");
%InstallBytecode(f, bc);

print("run");
print(f(["3+4"]));
