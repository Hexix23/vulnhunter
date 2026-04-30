function checkEq(expected, actual, label) {
  if (expected !== actual) {
    throw new Error(label + ': expected ' + expected + ', got ' + actual);
  }
}

function probe(s, seed) {
  %ScheduleGCInStackCheck();

  // Force external-string fast path before the loop.
  const first = s.charCodeAt(1);

  // The post-loop index is data-dependent on the loop so the second char load
  // cannot be trivially folded to the same pre-loop value.
  let j = seed & 3;
  for (let i = 0; i < 20000; i++) {
    j = (j + 1) & 3;
  }

  // Target: if LoadExternalPointer(resource) is considered effect-free, the
  // resource pointer from the first charCodeAt may be reused here, after a
  // JSStackCheck that can process full GC.
  const second = s.charCodeAt(j);
  return first + second + j;
}

const external = 'abc' + 'def';
externalizeString(external);

%PrepareFunctionForOptimization(probe);
checkEq(98 + 97 + 0, probe(external, 0), 'warmup seed 0');
checkEq(98 + 98 + 1, probe(external, 1), 'warmup seed 1');
%OptimizeFunctionOnNextCall(probe);
checkEq(98 + 99 + 2, probe(external, 2), 'optimized seed 2');

print('OK');
