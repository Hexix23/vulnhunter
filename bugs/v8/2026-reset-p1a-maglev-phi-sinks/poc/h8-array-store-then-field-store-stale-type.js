// Flags: --allow-natives-syntax --maglev --maglev-untagged-phis --expose-gc

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
const object_value = { payload: 0x1234 };
const arr = [null];
const holder = { x: "warmup" };
holder.x = object_value;

function f(c) {
  let phi1 = c ? H0 : H1;
  phi1 + 1;
  let v = c ? object_value : phi1;
  arr[0] = v;
  holder.x = v;
}

%PrepareFunctionForOptimization(f);
f(true);
f(true);

%OptimizeMaglevOnNextCall(f);
f(true);
assertMaglev(f);
assertEquals(0x1234, holder.x.payload);

f(false);
assertEquals(7, holder.x);
