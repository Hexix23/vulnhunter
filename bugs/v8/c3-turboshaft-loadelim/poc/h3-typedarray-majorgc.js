function checkEq(expected, actual, label) {
  if (expected !== actual) {
    throw new Error(label + ': expected ' + expected + ', got ' + actual);
  }
}

function hot() {
  const ta = new Int32Array(2);
  ta[0] = 19;
  ta[1] = 23;

  const v1 = ta[1];
  %MajorGCForCompilerTesting();
  const v2 = ta[0];
  return v1 + v2;
}

%PrepareFunctionForOptimization(hot);
checkEq(42, hot(), 'baseline 1');
checkEq(42, hot(), 'baseline 2');
%OptimizeFunctionOnNextCall(hot);
checkEq(42, hot(), 'optimized');
print('OK');
