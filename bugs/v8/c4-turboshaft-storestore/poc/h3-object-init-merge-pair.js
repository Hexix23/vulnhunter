// C4/H3: consecutive compressed tagged initialization stores may be merged
// into a single Uint64 store only when relocation/write-barrier requirements
// are safe.
//
// This is a trace oracle for the merge-pair half of
// StoreStoreEliminationReducer.

function make(v) {
  // Undefined/null are read-only roots and should be eligible as constants.
  // The dynamic field keeps the object observable.
  return {a: undefined, b: null, c: v};
}

%PrepareFunctionForOptimization(make);
let last;
for (let i = 0; i < 1000; i++) {
  last = make(i);
  if (last.a !== undefined || last.b !== null || last.c !== i) {
    throw new Error("warmup mismatch");
  }
}

%OptimizeFunctionOnNextCall(make);
for (let i = 0; i < 1000; i++) {
  last = make(i);
  if (last.a !== undefined || last.b !== null || last.c !== i) {
    throw new Error("optimized mismatch");
  }
}
print("OK");
