// C18 H40: valid bytecode, copy another function's global-load PropertyCell.
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

var C18_H40_A = 13;
var C18_H40_B = 99;
function f() {
  return C18_H40_A;
}
function g() {
  return C18_H40_B;
}

%EnsureFeedbackVectorForFunction(f);
%EnsureFeedbackVectorForFunction(g);
for (let i = 0; i < 1000; i++) {
  f();
  g();
}

let fvF = feedbackVectorOf(f);
let fvG = feedbackVectorOf(g);
let fSlot0 = getField(fvF, slotOffset(0));
let gSlot0 = getField(fvG, slotOffset(0));

print(`before f=${f()} g=${g()}`);
print(`fvF=0x${fvF.toString(16)} fSlot0=0x${fSlot0.toString(16)}`);
print(`fvG=0x${fvG.toString(16)} gSlot0=0x${gSlot0.toString(16)}`);

setField(fvF, slotOffset(0), gSlot0);

let after = f();
print(`after f=${after} g=${g()}`);
print("f_is_A", after === C18_H40_A);
print("f_is_B", after === C18_H40_B);
print("done");
