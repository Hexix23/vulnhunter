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

const H0 = %AllocateHeapNumberWithValue(42.0);
const H1 = %AllocateHeapNumberWithValue(7.0);
const object_value = {};
const arr = [null];

function C() {}

function f(c) {
  let phi1 = c ? H0 : H1;
  phi1 + 1;
  let v = c ? object_value : phi1;
  arr[0] = v;
  return v instanceof C;
}

%PrepareFunctionForOptimization(f);
assertEquals(false, f(true));
assertEquals(false, f(true));

%OptimizeMaglevOnNextCall(f);
assertEquals(false, f(true));
assertMaglev(f);

assertEquals(false, f(false));
