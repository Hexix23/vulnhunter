// C1 H3: Peeled loop backedge speculates Int32-like phi, then final backedge
// carries HeapNumber.

function ref(n, trigger) {
  let x = 0;
  for (let i = 0; i < n; i++) {
    if (trigger && i === n - 2) {
      x = 1.5;
    } else {
      x = x + 1;
    }
  }
  return x;
}

function opt(n, trigger) {
  let x = 0;
  for (let i = 0; i < n; i++) {
    if (trigger && i === n - 2) {
      x = 1.5;
    } else {
      x = x + 1;
    }
  }
  return x;
}

%NeverOptimizeFunction(ref);
%PrepareFunctionForOptimization(opt);

for (let i = 0; i < 1000; i++) opt(8, false);
let base = ref(8, true);

%OptimizeMaglevOnNextCall(opt);
let warm = opt(8, false);
let maglev_after_warm = %ActiveTierIsMaglev(opt);
let got = opt(8, true);
let maglev_after_got = %ActiveTierIsMaglev(opt);

print(`base=${base}`);
print(`warm=${warm}`);
print(`got=${got}`);
print(`maglev_after_warm=${maglev_after_warm}`);
print(`maglev_after_got=${maglev_after_got}`);
print(`status=${%GetOptimizationStatus(opt)}`);
print(got === base ? 'OK' : 'MISMATCH');
