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

const H0 = %AllocateHeapNumberWithValue(42.0);
const H1 = %AllocateHeapNumberWithValue(7.0);
const object_value = { payload: 0x1234 };
const arr = [null];

function f(c) {
  let phi1 = c ? H0 : H1;
  phi1 + 1;
  let v = c ? object_value : phi1;
  arr[0] = v;
  return Reflect.getPrototypeOf(v);
}

%PrepareFunctionForOptimization(f);
assertEquals(Object.prototype, f(true));
assertEquals(Object.prototype, f(true));

%OptimizeMaglevOnNextCall(f);
assertEquals(Object.prototype, f(true));
assertMaglev(f);

assertThrows(() => f(false));
