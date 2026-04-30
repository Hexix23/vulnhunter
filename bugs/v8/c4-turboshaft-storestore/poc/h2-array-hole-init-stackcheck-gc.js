// C4/H2: JSStackCheck(loop) can allocate / run GC, so initializing stores
// before it must be treated as GCObservable by store-store elimination.
//
// Success criterion:
//   ASAN / verify_heap crash, DCHECK, or release divergence when the initial
//   hole store is incorrectly removed before a stack-check-triggered GC.

function f(n) {
  let arr = new Array(5);
  %ScheduleGCInStackCheck();
  for (let i = 0; i < n; i++) {
    // Force a loop stack check in optimized code without otherwise touching arr.
  }
  arr[3] = 42;
  return arr[3];
}

%PrepareFunctionForOptimization(f);
for (let i = 0; i < 20; i++) {
  if (f(1000) !== 42) throw new Error("warmup mismatch");
}
%OptimizeFunctionOnNextCall(f);
for (let i = 0; i < 200; i++) {
  if (f(10000) !== 42) throw new Error("optimized mismatch");
}
print("OK");
