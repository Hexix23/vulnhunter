// C18 H41: valid bytecode, copy StoreGlobal feedback PropertyCell from B into A writer.
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

var C18_H41_A = 13;
var C18_H41_B = 99;
function setA(v) {
  C18_H41_A = v;
}
function setB(v) {
  C18_H41_B = v;
}

%EnsureFeedbackVectorForFunction(setA);
%EnsureFeedbackVectorForFunction(setB);
for (let i = 0; i < 1000; i++) {
  setA(13);
  setB(99);
}

let fvA = feedbackVectorOf(setA);
let fvB = feedbackVectorOf(setB);
let aSlot0 = getField(fvA, slotOffset(0));
let bSlot0 = getField(fvB, slotOffset(0));

print(`before A=${C18_H41_A} B=${C18_H41_B}`);
print(`fvA=0x${fvA.toString(16)} aSlot0=0x${aSlot0.toString(16)}`);
print(`fvB=0x${fvB.toString(16)} bSlot0=0x${bSlot0.toString(16)}`);

setField(fvA, slotOffset(0), bSlot0);
setA(777);

print(`after A=${C18_H41_A} B=${C18_H41_B}`);
print("A_changed", C18_H41_A === 777);
print("B_changed", C18_H41_B === 777);
print("done");
