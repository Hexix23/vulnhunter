function checkEq(expected, actual, label) {
  if (expected !== actual) {
    throw new Error(label + ': expected ' + expected + ', got ' + actual);
  }
}

function hot() {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setInt32(0, 19);
  dv.setInt32(4, 23);

  const v1 = dv.getInt32(4);

  %ScheduleGCInStackCheck();
  let sink = 0;
  for (let i = 0; i < 20000; ++i) {
    sink += i;
  }

  const v2 = dv.getInt32(0);
  return v1 + v2 + (sink === -1 ? 1 : 0);
}

%PrepareFunctionForOptimization(hot);
checkEq(42, hot(), 'baseline 1');
checkEq(42, hot(), 'baseline 2');
%OptimizeFunctionOnNextCall(hot);
checkEq(42, hot(), 'optimized');
print('OK');
