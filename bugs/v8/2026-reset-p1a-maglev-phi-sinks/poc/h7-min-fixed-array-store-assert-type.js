// Flags: --allow-natives-syntax --maglev --maglev-untagged-phis --maglev-assert-types

const H0 = %AllocateHeapNumberWithValue(42.0);
const H1 = %AllocateHeapNumberWithValue(7.0);
const object_value = { payload: 0x1234 };
const arr = [null];

function f(c) {
  let phi1 = c ? H0 : H1;
  phi1 + 1;
  let v = c ? object_value : phi1;
  arr[0] = v;
}

%PrepareFunctionForOptimization(f);
f(true);
f(true);

%OptimizeMaglevOnNextCall(f);
f(true);

if ((%GetOptimizationStatus(f) & (1 << 4)) === 0) {
  throw new Error("function did not reach Maglev");
}

f(false);
