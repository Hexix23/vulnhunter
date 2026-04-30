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

function assertNaN(actual) {
  if (actual === actual) {
    throw new Error(`expected NaN, got ${actual}`);
  }
}

function assertMaglev(fn) {
  if ((%GetOptimizationStatus(fn) & (1 << 4)) === 0) {
    throw new Error("function did not reach Maglev");
  }
}

const H0 = %AllocateHeapNumberWithValue(9.0);
const H1 = %AllocateHeapNumberWithValue(11.0);
const obj = { x: 1337, y: 1 };

function f(c) {
  let phi1 = c ? H0 : H1;
  phi1 | 0;
  let v = c ? obj : phi1;
  return v.x + 1;
}

%PrepareFunctionForOptimization(f);
assertEquals(1338, f(true));
assertEquals(1338, f(true));

%OptimizeMaglevOnNextCall(f);
assertEquals(1338, f(true));
assertMaglev(f);

assertNaN(f(false));
