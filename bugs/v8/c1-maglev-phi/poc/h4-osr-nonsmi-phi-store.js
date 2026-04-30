// C1 H4: OSR value phi starts Smi-like, then carries a non-Smi HeapNumber and
// is stored through Maglev after OSR. Variant of local regress-482261044-3.

function ref(trigger) {
  let phi = 0;
  let obj = {v: -1};
  let x = 0x4e000000;
  for (let i = 0; i < 200; ++i) {
    if (i === 100 && trigger) phi = x;
    obj.v = phi;
  }
  return obj.v;
}

function opt(trigger) {
  let phi = 0;
  let obj = {v: -1};
  let x = 0x4e000000;
  for (let i = 0; i < 200; ++i) {
    if (i === 100 && trigger) phi = x;
    obj.v = phi;
    if (i === 10 && trigger) %OptimizeOsr();
  }
  return obj.v;
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
