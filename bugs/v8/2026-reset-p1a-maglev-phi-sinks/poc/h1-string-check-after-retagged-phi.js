// Flags: --allow-natives-syntax --maglev --maglev-untagged-phis

function assertEquals(expected, actual) {
  if (expected !== actual) {
    throw new Error(`expected ${expected}, got ${actual}`);
  }
}

function assertThrows(fn) {
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = e instanceof TypeError;
  }
  if (!threw) throw new Error("expected TypeError");
}

function assertMaglev(fn) {
  if ((%GetOptimizationStatus(fn) & (1 << 4)) === 0) {
    throw new Error("function did not reach Maglev");
  }
}

const H0 = %AllocateHeapNumberWithValue(7.0);
const H1 = %AllocateHeapNumberWithValue(13.0);

function f(c) {
  let phi1 = c ? H0 : H1;
  phi1 | 0;
  let v = c ? "abcdef" : phi1;
  return v.indexOf("d");
}

%PrepareFunctionForOptimization(f);
assertEquals(3, f(true));
assertEquals(3, f(true));

%OptimizeMaglevOnNextCall(f);
assertEquals(3, f(true));
assertMaglev(f);

assertThrows(() => f(false));
