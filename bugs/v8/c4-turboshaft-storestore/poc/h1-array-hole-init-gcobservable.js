// C4/H1: array hole initialization must remain GC-observable.
//
// Source contract:
//   src/compiler/turboshaft/store-store-elimination-reducer-inl.h
//   - allocations / consistent-heap operations mark unobservable stores as
//     GCObservable
//   - initializing stores must not be eliminated when they are GCObservable
//
// This is a local reduction of the upstream regression shape in
// test/mjsunit/compiler/regress-crbug-1464516.js, with explicit optimization.

function f() {
  let arr = new Array(5);

  // Keep enough allocation pressure between the allocation and the later store
  // that an incorrectly eliminated hole initialization can be observed by GC.
  [arr, 5, 6, 7, [8], [9]];
  [2, 5, 6, 7, [8], [9]];
  [2, 5, 6, 7, [8], [9]];
  [2, 5, 6, 7, [8], [9]];
  [2, 5, 6, 7, [8], [9]];
  [2, 5, 6, 7, [8], [9]];

  arr[3] = 42;
  return arr[3];
}

%PrepareFunctionForOptimization(f);
for (let i = 0; i < 100; i++) {
  if (f() !== 42) throw new Error("warmup mismatch");
}
%OptimizeFunctionOnNextCall(f);
for (let i = 0; i < 5000; i++) {
  if (f() !== 42) throw new Error("optimized mismatch");
}
print("OK");
