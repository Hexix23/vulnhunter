// C4-H6: Store-store elimination must not assume two tagged bases are disjoint
// just because warmup mostly used distinct objects.
//
// Expected:
// - alias_existing(same, same, true) returns 2.
// - alias_transition(same, same, true) returns 22.
// - aliased_pair(same, same, true) returns 8.

function assertEq(got, expected, label) {
  if (got !== expected) {
    throw new Error(label + ": got " + got + ", expected " + expected);
  }
}

function makeExisting() {
  return { x: 0, pad: 13 };
}

function makeBase() {
  return { pad: 13 };
}

function alias_existing(o, p, alias) {
  const a = alias ? o : p;
  const b = o;
  a.x = 1;
  b.x = 2;
  return a.x;
}

function alias_transition(o, p, alias) {
  const a = alias ? o : p;
  const b = o;
  a.y = 11;
  b.y = 22;
  return a.y;
}

function aliased_pair(o, p, flip) {
  const a = flip ? o : p;
  const b = flip ? p : o;
  a.x = 7;
  b.x = 8;
  return a.x + b.x;
}

%PrepareFunctionForOptimization(alias_existing);
%PrepareFunctionForOptimization(alias_transition);
%PrepareFunctionForOptimization(aliased_pair);

for (let i = 0; i < 20000; i++) {
  const o1 = makeExisting();
  const p1 = makeExisting();
  assertEq(alias_existing(o1, p1, false), 1, "warm existing distinct");

  const o2 = makeBase();
  const p2 = makeBase();
  assertEq(alias_transition(o2, p2, false), 11, "warm transition distinct");

  const o3 = makeExisting();
  const p3 = makeExisting();
  assertEq(aliased_pair(o3, p3, false), 15, "warm pair distinct");
}

%OptimizeFunctionOnNextCall(alias_existing);
%OptimizeFunctionOnNextCall(alias_transition);
%OptimizeFunctionOnNextCall(aliased_pair);

assertEq(alias_existing(makeExisting(), makeExisting(), false), 1,
         "optimized existing distinct");
assertEq(alias_transition(makeBase(), makeBase(), false), 11,
         "optimized transition distinct");
assertEq(aliased_pair(makeExisting(), makeExisting(), false), 15,
         "optimized pair distinct");

for (let i = 0; i < 10000; i++) {
  const same1 = makeExisting();
  assertEq(alias_existing(same1, same1, true), 2,
           "optimized existing alias");

  const same2 = makeBase();
  assertEq(alias_transition(same2, same2, true), 22,
           "optimized transition alias");

  const same3 = makeExisting();
  assertEq(aliased_pair(same3, same3, true), 16,
           "optimized pair alias");
}

print("OK");
