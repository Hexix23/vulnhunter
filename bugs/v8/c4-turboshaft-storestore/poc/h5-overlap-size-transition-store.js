// C4/H5: partial-overlap / mixed-size stores to same object area must not let
// store-store elimination hide an observable write.
//
// This shape uses a property kind transition: a Smi field followed by a double
// field at the same logical property, plus a second property to keep object
// layout observable. The goal is to surface mixed TaggedSigned/Float64 stores
// around the same base/offset in Turboshaft trace.

function make(v, flip) {
  const o = {x: 1, y: 2};
  if (flip) {
    o.x = 13.37;
  } else {
    o.x = v | 0;
  }
  o.y = 0x1234;
  return o.x + o.y;
}

%PrepareFunctionForOptimization(make);
for (let i = 0; i < 2000; i++) {
  make(i, false);
}
%OptimizeFunctionOnNextCall(make);

for (let i = 0; i < 2000; i++) {
  const got = make(i, false);
  const want = (i | 0) + 0x1234;
  if (got !== want) throw new Error("smi mismatch: " + got + " vs " + want);
}

const d = make(1, true);
if (d !== 13.37 + 0x1234) throw new Error("double mismatch: " + d);
print("OK");
