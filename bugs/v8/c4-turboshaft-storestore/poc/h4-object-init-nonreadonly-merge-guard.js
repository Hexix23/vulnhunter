// C4/H4: object initialization must not merge adjacent stores when either
// value is a non-read-only heap object requiring relocation/write-barrier care.
//
// Trace oracle:
//   With --turboshaft-trace-reduction, a safe merge appears as a raw Uint64
//   store replacing two adjacent 32-bit initialization stores. This test tries
//   to put two non-read-only object constants in adjacent fields and compares
//   store-elim on/off.

const markerA = {tag: 0x41};
const markerB = {tag: 0x42};

function make(i) {
  // These are heap object values outside read-only space. If their adjacent
  // stores merged into a raw Uint64 without reloc/barrier handling, GC can lose
  // track of them.
  return {a: markerA, b: markerB, c: i};
}

%PrepareFunctionForOptimization(make);
let last;
for (let i = 0; i < 1000; i++) {
  last = make(i);
  if (last.a !== markerA || last.b !== markerB || last.c !== i) {
    throw new Error("warmup mismatch");
  }
}

%OptimizeFunctionOnNextCall(make);
for (let i = 0; i < 5000; i++) {
  last = make(i);
  if (last.a !== markerA || last.b !== markerB || last.c !== i) {
    throw new Error("optimized mismatch");
  }
  if ((i & 255) === 0) gc();
}
print("OK");
