// C11-H7: JS-level approximation of cctest Regress8617.
// The descriptor array barrier must publish the newly visible descriptor range
// and mark/move descriptor values correctly during incremental marking +
// compaction. The oracle is repeated method use after descriptor growth.

function assertEq(got, expected, label) {
  if (got !== expected) {
    throw new Error(label + ": got " + got + ", expected " + expected);
  }
}

function makeCallable(seed) {
  return function method() {
    return seed + 42;
  };
}

function forceOldSpace() {
  const trash = [];
  for (let i = 0; i < 2500; i++) {
    trash.push({i, a: i + 1, b: "descriptor-trash-" + i});
  }
  gc();
  return trash;
}

function growDescriptor(obj, round) {
  obj["bar_" + round] = round;
  Object.defineProperty(obj, "acc_" + round, {
    configurable: true,
    enumerable: true,
    get() {
      return round;
    }
  });
}

function probe(round) {
  const fn = makeCallable(round);
  const keep = forceOldSpace();
  const obj = {};
  obj.method = fn;

  assertEq(obj.method(), round + 42, "pre");
  %HeapObjectVerify(obj);

  for (let i = 0; i < 40; i++) {
    growDescriptor(obj, (round << 8) | i);
    if ((i & 7) === 0) gc();
  }

  gc();
  %HeapObjectVerify(obj);
  assertEq(obj.method(), round + 42, "post");

  return keep.length + obj.method();
}

let checksum = 0;
for (let round = 0; round < 18; round++) {
  checksum += probe(round);
}

if (checksum <= 0) throw new Error("bad checksum");
print("OK");
