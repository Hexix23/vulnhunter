// C18 H43: cross-global PropertyCell corruption survives optimized caller.
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

var C18_H43_A = 13;
var C18_H43_B = 99;
function f() {
  return C18_H43_A;
}
function g() {
  return C18_H43_B;
}
function caller() {
  return f() + 1;
}

%EnsureFeedbackVectorForFunction(f);
%EnsureFeedbackVectorForFunction(g);
%PrepareFunctionForOptimization(caller);
for (let i = 0; i < 1000; i++) {
  f();
  g();
  caller();
}

let fvF = feedbackVectorOf(f);
let fvG = feedbackVectorOf(g);
setField(fvF, slotOffset(0), getField(fvG, slotOffset(0)));

print(`preopt caller=${caller()} f=${f()}`);
%OptimizeFunctionOnNextCall(caller);
let optimized = caller();
print(`optimized caller=${optimized} f=${f()}`);
C18_H43_B = 123;
print(`after-B-write caller=${caller()} f=${f()}`);
print("done");
