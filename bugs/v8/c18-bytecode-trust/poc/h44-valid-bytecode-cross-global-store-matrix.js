// C18 H44: StoreGlobal FeedbackVector slot matrix.
// Usage: d8 --sandbox-testing --allow-natives-syntax h44...js -- <destSlot> <srcSlot>
const kHeapObjectTag = 0x1;
const kJSFunctionType = Sandbox.getInstanceTypeIdFor("JS_FUNCTION_TYPE");
const kJSFunctionFeedbackCellOffset =
    Sandbox.getFieldOffset(kJSFunctionType, "feedback_cell");
const kFeedbackCellType = Sandbox.getInstanceTypeIdFor("FEEDBACK_CELL_TYPE");
const kFeedbackCellValueOffset =
    Sandbox.getFieldOffset(kFeedbackCellType, "value");

let destSlot = 0;
let srcSlot = 0;
if (typeof arguments !== "undefined") {
  if (arguments.length > 0) destSlot = Number(arguments[0]);
  if (arguments.length > 1) srcSlot = Number(arguments[1]);
}

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

var C18_H44_A = 13;
var C18_H44_B = 99;
function setA(v) {
  C18_H44_A = v;
}
function setB(v) {
  C18_H44_B = v;
}

%EnsureFeedbackVectorForFunction(setA);
%EnsureFeedbackVectorForFunction(setB);
for (let i = 0; i < 1000; i++) {
  setA(13);
  setB(99);
}

let fvA = feedbackVectorOf(setA);
let fvB = feedbackVectorOf(setB);
let srcVal = getField(fvB, slotOffset(srcSlot));
let oldDest = getField(fvA, slotOffset(destSlot));
setField(fvA, slotOffset(destSlot), srcVal);
setA(777);

print(`dest=${destSlot} src=${srcSlot} old=0x${oldDest.toString(16)} srcval=0x${srcVal.toString(16)} A=${C18_H44_A} B=${C18_H44_B} A777=${C18_H44_A === 777} B777=${C18_H44_B === 777}`);
