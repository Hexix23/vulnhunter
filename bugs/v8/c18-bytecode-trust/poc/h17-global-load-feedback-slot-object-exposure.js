// C18 H17: characterize H13. Avoid printing the returned value directly.
// H13 showed print() receiving ScopeInfo SCRIPT_SCOPE after LdaGlobal FBV[255].
var C18_GLOBAL_EXPOSE = 13;
function f() {
  return C18_GLOBAL_EXPOSE;
}

for (let i = 0; i < 1000; i++) f();
print("baseline", f());

let bc = %GetBytecode(f);
let bytes = new Uint8Array(bc.bytecode);
print("bytecode", Array.from(bytes).join(","));

for (let i = 0; i < bytes.length; i++) {
  if (bytes[i] === 0x23) {
    print("mutate-ldaglobal", i, bytes[i + 2], "->", 255);
    bytes[i + 2] = 255;
  }
}

print("install");
%InstallBytecode(f, bc);

print("run");
let r = f();
print("after-call");
try {
  print("typeof", typeof r);
} catch (e) {
  print("typeof-throw", e.name + ":" + e.message);
}
try {
  print("eq-undefined", r === undefined);
} catch (e) {
  print("eq-throw", e.name + ":" + e.message);
}
try {
  %DebugPrint(r);
  print("debugprint-ok");
} catch (e) {
  print("debugprint-throw", e.name + ":" + e.message);
}
