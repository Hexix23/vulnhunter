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
const arr = new Array(1);
arr[0] = null;

gc();
gc();

function churn() {
  for (let i = 0; i < 20000; i++) ({ a: i, b: i + 1 });
}

function f(c) {
  let phi1 = c ? H0 : H1;
  phi1 + 1;
  let v = c ? object_value : phi1;
  arr[0] = v;
}

%PrepareFunctionForOptimization(f);
f(true);
churn();

%OptimizeMaglevOnNextCall(f);
f(true);
assertMaglev(f);
gc();
churn();
gc();
assertEquals(0x1234, arr[0].payload);

f(false);
gc();
churn();
gc();
assertEquals(7, arr[0]);
