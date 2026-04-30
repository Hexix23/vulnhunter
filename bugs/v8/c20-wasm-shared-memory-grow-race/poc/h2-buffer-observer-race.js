const PAGE = 65536;
const memory = new WebAssembly.Memory({initial: 1, shared: true, maximum: 400});
const control = new Int32Array(memory.buffer, 0, 8);

const workerCode = `
  onmessage = ({data}) => {
    const memory = data.memory;
    const control = new Int32Array(memory.buffer, 0, 8);
    Atomics.add(control, 0, 1);
    while (Atomics.load(control, 1) === 0) {}
    for (let i = 0; i < data.rounds; i++) {
      const before = memory.buffer.byteLength;
      const old = memory.grow((i & 1) === 0 ? 1 : 0);
      const after = memory.buffer.byteLength;
      if (after < before) Atomics.store(control, 4, 1);
      if (old < 0) Atomics.store(control, 5, 1);
      Atomics.add(control, 2, 1);
    }
    Atomics.add(control, 3, 1);
  }
`;

const workers = 4;
const rounds = 60;
for (let i = 0; i < workers; i++) {
  new Worker(workerCode, {type: "string"}).postMessage({memory, rounds});
}

while (Atomics.load(control, 0) < workers) {}
Atomics.store(control, 1, 1);

let last = memory.buffer.byteLength;
while (Atomics.load(control, 3) < workers) {
  const before = memory.buffer;
  const old = memory.grow(0);
  const after = memory.buffer;
  if (old * PAGE > after.byteLength) throw new Error("grow(0) return beyond visible buffer");
  if (after.byteLength < last) throw new Error("buffer length regressed");
  last = after.byteLength;
  if (before !== after && after.byteLength < before.byteLength) {
    throw new Error("refreshed to smaller buffer");
  }
}

if (Atomics.load(control, 4) !== 0) throw new Error("worker saw byteLength regression");
if (Atomics.load(control, 5) !== 0) throw new Error("worker saw negative grow result");
print("OK");
