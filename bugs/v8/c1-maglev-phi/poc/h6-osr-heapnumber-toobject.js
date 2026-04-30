// C1 H6: OSR phi feeds ToObject/for-in after feedback saw HeapNumber shape.
// Based on local Maglev regress-329476993, reduced to a differential oracle.

function ref() {
  let seen = 0;
  for (let i = 0; i < 5; i++) {
    const v1 = undefined;
    const v2 = v1 | v1;
    const v3 = v2 ** v2;
    for (const k in v3) seen++;
  }
  return seen;
}

function opt() {
  let seen = 0;
  for (let i = 0; i < 5; i++) {
    const v1 = %OptimizeOsr();
    const v2 = v1 | v1;
    const v3 = v2 ** v2;
    for (const k in v3) seen++;
  }
  return seen;
}

%NeverOptimizeFunction(ref);
%PrepareFunctionForOptimization(opt);

let base = ref();
let got = opt();

print(`base=${base}`);
print(`got=${got}`);
print(`status=${%GetOptimizationStatus(opt)}`);
print(got === base ? 'OK' : 'MISMATCH');
