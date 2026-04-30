// C1 H5: Same OSR non-Smi phi, but flowing into fixed-array element storage
// and then reloaded after the loop.

function ref(trigger) {
  let phi = 0;
  let arr = [0, 1, 2];
  let x = 0x4e000000;
  for (let i = 0; i < 200; ++i) {
    if (i === 100 && trigger) phi = x;
    arr[1] = phi;
  }
  return arr[1];
}

function opt(trigger) {
  let phi = 0;
  let arr = [0, 1, 2];
  let x = 0x4e000000;
  for (let i = 0; i < 200; ++i) {
    if (i === 100 && trigger) phi = x;
    arr[1] = phi;
    if (i === 10 && trigger) %OptimizeOsr();
  }
  return arr[1];
}

%NeverOptimizeFunction(ref);
%PrepareFunctionForOptimization(opt);

let base = ref(true);
let warm = opt(false);
let got = opt(true);

print(`base=${base}`);
print(`warm=${warm}`);
print(`got=${got}`);
print(`status=${%GetOptimizationStatus(opt)}`);
print(got === base ? 'OK' : 'MISMATCH');
