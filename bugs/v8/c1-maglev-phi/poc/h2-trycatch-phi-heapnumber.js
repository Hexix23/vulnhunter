// C1 H2: Phi over try/catch. Train no-throw path as Int32, then throw path
// assigns HeapNumber through valueOf in catch.

function ref(trigger, obj) {
  let x = 0;
  for (let i = 0; i < 4; i++) {
    try {
      if (i === 2 && trigger) throw obj;
    } catch (e) {
      x = e.valueOf();
    }
    x = x + 1;
  }
  return x;
}

function opt(trigger, obj) {
  let x = 0;
  for (let i = 0; i < 4; i++) {
    try {
      if (i === 2 && trigger) throw obj;
    } catch (e) {
      x = e.valueOf();
    }
    x = x + 1;
  }
  return x;
}

%NeverOptimizeFunction(ref);
%PrepareFunctionForOptimization(opt);

let obj = { valueOf() { return 1.5; } };

for (let i = 0; i < 1000; i++) opt(false, obj);
let base = ref(true, obj);

%OptimizeMaglevOnNextCall(opt);
let warm = opt(false, obj);
let maglev_after_warm = %ActiveTierIsMaglev(opt);
let got = opt(true, obj);
let maglev_after_got = %ActiveTierIsMaglev(opt);

print(`base=${base}`);
print(`warm=${warm}`);
print(`got=${got}`);
print(`maglev_after_warm=${maglev_after_warm}`);
print(`maglev_after_got=${maglev_after_got}`);
print(`status=${%GetOptimizationStatus(opt)}`);
print(got === base ? 'OK' : 'MISMATCH');
