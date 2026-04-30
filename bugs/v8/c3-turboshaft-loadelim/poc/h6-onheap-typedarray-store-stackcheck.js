function checkEq(expected, actual, label) {
  if (expected !== actual) {
    throw new Error(label + ': expected ' + expected + ', got ' + actual);
  }
}

// Keep this helper cold. If the optimized store writes through a stale raw
// pointer, this read should observe the real typed-array backing object.
%NeverOptimizeFunction(coldRead);
function coldRead(ta) {
  return ta[0];
}

function hot() {
  // 8 bytes is below V8_TYPED_ARRAY_MAX_SIZE_IN_HEAP=64 in this build, so this
  // starts as an on-heap typed array until .buffer/GetBuffer materializes it.
  const ta = new Int32Array(2);
  ta[0] = 11;
  ta[1] = 31;

  // Schedule full GC at the next loop stack check before the first optimized
  // typed-array access. The intended aliasing window is:
  //   first access -> JSStackCheck(kLoop) full GC -> second access/store.
  %ScheduleGCInStackCheck();

  const before = ta[1];
  let sink = 0;
  for (let i = 0; i < 20000; ++i) {
    sink += i;
  }

  ta[0] = 123456;
  return before + coldRead(ta) + (sink === -1 ? 1 : 0);
}

%PrepareFunctionForOptimization(hot);
checkEq(123487, hot(), 'baseline 1');
checkEq(123487, hot(), 'baseline 2');
%OptimizeFunctionOnNextCall(hot);
checkEq(123487, hot(), 'optimized');
print('OK');
