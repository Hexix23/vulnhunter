// C4-H7: PropertyArray initialization can create a merged 64-bit store for two
// adjacent undefined slots, followed by a smaller tagged store to one slot.
// The earlier wide initialization must not be considered fully shadowed by the
// later partial overwrite.

function assertEq(got, expected, label) {
  if (got !== expected) {
    throw new Error(label + ": got " + got + ", expected " + expected);
  }
}

function makeBase() {
  return { pad: 13 };
}

function grow_with_partial_overwrite(o, value, pressure) {
  // Make the transition allocation run under heap verification pressure.
  if (pressure) %SimulateNewspaceFull();
  o.y = value;
  return o.y;
}

%PrepareFunctionForOptimization(grow_with_partial_overwrite);

for (let i = 0; i < 10000; i++) {
  assertEq(grow_with_partial_overwrite(makeBase(), 11, false), 11, "warm");
}

%OptimizeFunctionOnNextCall(grow_with_partial_overwrite);
assertEq(grow_with_partial_overwrite(makeBase(), 22, false), 22, "optimized");

for (let i = 0; i < 200; i++) {
  const value = (i & 1) ? 33 : 44;
  assertEq(grow_with_partial_overwrite(makeBase(), value, true), value,
           "stress");
}

print("OK");
