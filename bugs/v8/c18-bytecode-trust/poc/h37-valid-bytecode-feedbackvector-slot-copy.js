// C18 H37: valid bytecode, corrupt FeedbackVector slot0 from slot4.
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

var C18_H37_GLOBAL = 13;
function f() {
  return C18_H37_GLOBAL;
}

%EnsureFeedbackVectorForFunction(f);
for (let i = 0; i < 1000; i++) f();

let fp = getPtr(f);
let fc = getField(fp, kJSFunctionFeedbackCellOffset);
let fv = getField(fc, kFeedbackCellValueOffset);
let slot0 = getField(fv, slotOffset(0));
let slot4 = getField(fv, slotOffset(4));

print(`baseline=${f()}`);
print(`fv=0x${fv.toString(16)} slot0=0x${slot0.toString(16)} slot4=0x${slot4.toString(16)}`);

setField(fv, slotOffset(0), slot4);

let r = f();
let box = {v: r};
print("returned");
print("same-global", r === C18_H37_GLOBAL);
try {
  print("typeof", typeof box.v);
} catch (e) {
  print("typeof-throw", e.name + ":" + e.message);
}
print("done");
