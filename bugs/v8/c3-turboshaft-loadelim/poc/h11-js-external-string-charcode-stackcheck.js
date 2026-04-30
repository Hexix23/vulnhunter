function checkEq(expected, actual, label) {
  if (expected !== actual) {
    throw new Error(label + ': expected ' + expected + ', got ' + actual);
  }
}

function probe(s) {
  %ScheduleGCInStackCheck();
  const first = s.charCodeAt(2);
  for (let i = 0; i < 20000; i++) {}
  const second = s.charCodeAt(2);
  return first + second;
}

const seq = 'abcdef';
const external = 'abc' + 'def';
externalizeString(external);

%PrepareFunctionForOptimization(probe);
checkEq(198, probe(seq), 'seq warmup');
checkEq(198, probe(external), 'external warmup');
%OptimizeFunctionOnNextCall(probe);
checkEq(198, probe(external), 'external optimized');

print('OK');
