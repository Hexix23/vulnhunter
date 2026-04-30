// Flags: --allow-natives-syntax --maglev --maglev-untagged-phis

function assertEquals(expected, actual) {
  if (expected !== actual) {
    throw new Error(`expected ${expected}, got ${actual}`);
  }
}

function assertMaglev(fn) {
  if ((%GetOptimizationStatus(fn) & (1 << 4)) === 0) {
    throw new Error("function did not reach Maglev");
  }
}

const H0 = %AllocateHeapNumberWithValue(0.0);
const H1 = %AllocateHeapNumberWithValue(1.0);
const truthy = { marker: 1 };

function f(c) {
  let phi1 = c ? H0 : H1;
  phi1 + 1;
  let v = c ? phi1 : truthy;
  if (v) return 1;
  return 0;
}

%PrepareFunctionForOptimization(f);
assertEquals(0, f(true));
assertEquals(0, f(true));

%OptimizeMaglevOnNextCall(f);
assertEquals(0, f(true));
assertMaglev(f);
assertEquals(1, f(false));
