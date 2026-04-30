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

const H0 = %AllocateHeapNumberWithValue(12.0);
const H1 = %AllocateHeapNumberWithValue(34.0);
let side_effects = 0;
const obj = {
  toString() {
    side_effects++;
    return "object-path";
  },
};

function f(c) {
  let phi1 = c ? H0 : H1;
  phi1 + 1;
  let v = c ? phi1 : obj;
  return String(v);
}

%PrepareFunctionForOptimization(f);
assertEquals("12", f(true));
assertEquals("12", f(true));

%OptimizeMaglevOnNextCall(f);
assertEquals("12", f(true));
assertMaglev(f);

assertEquals("object-path", f(false));
assertEquals(1, side_effects);
