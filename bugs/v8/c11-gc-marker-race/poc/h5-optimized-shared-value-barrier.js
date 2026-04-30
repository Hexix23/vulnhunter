// C11-H5: optimized stores into shared objects must keep the shared value
// barrier. SharedGC verifies that optimized code did not create shared->local
// edges while incremental marking is stressed.

function assertEq(got, expected, label) {
  if (got !== expected) {
    throw new Error(label + ": got " + got + ", expected " + expected);
  }
}

const Box = new SharedStructType(["payload"]);
let sharedArray;
let sharedBox;

function f(i) {
  sharedArray = new SharedArray(4000);
  sharedBox = new Box();
  // Force HeapNumber allocation in optimized code. The shared value barrier
  // must copy/share the value instead of storing a local heap object.
  const value = 2000000000 + (i & 7);
  sharedArray[0] = value;
  sharedBox.payload = value;
  return sharedBox.payload;
}

%PrepareFunctionForOptimization(f);
for (let i = 0; i < 32; i++) assertEq(f(i), 2000000000 + (i & 7), "warm");
%OptimizeFunctionOnNextCall(f);

for (let i = 0; i < 256; i++) {
  assertEq(f(i), 2000000000 + (i & 7), "optimized");
  if ((i & 15) === 0) {
    gc();
    %SharedGC();
  }
}

%SharedGC();
print("OK");
