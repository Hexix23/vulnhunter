// C18 H38: valid bytecode + corrupted FeedbackVector slot, then Array.join.
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

var C18_H38_GLOBAL = 13;
function f() {
  return C18_H38_GLOBAL;
}

%EnsureFeedbackVectorForFunction(f);
for (let i = 0; i < 1000; i++) f();

let fp = getPtr(f);
let fc = getField(fp, kJSFunctionFeedbackCellOffset);
let fv = getField(fc, kFeedbackCellValueOffset);
setField(fv, slotOffset(0), getField(fv, slotOffset(4)));

let r = f();
let arr = [r, 1, 2];
print("start");
print("same-global", r === C18_H38_GLOBAL);
print("join", arr.join("|"));
print("done");
