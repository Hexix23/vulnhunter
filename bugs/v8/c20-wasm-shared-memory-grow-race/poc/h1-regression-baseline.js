let targetMemory =
    new WebAssembly.Memory({initial: 1, shared: true, maximum: 1000});

const kNumWorkers = 2;
const kMaxGrows = 50;

let control = new Int32Array(targetMemory.buffer, 0, 4);

let workerCode = `
  onmessage = function(event) {
    let {targetMemory, kMaxGrows} = event.data;
    let control = new Int32Array(targetMemory.buffer, 0, 4);
    Atomics.add(control, 0, 1);
    while (Atomics.load(control, 1) === 0) {}
    for (let i = 0; i < kMaxGrows; ++i) {
      let b = targetMemory.buffer;
      if (b.byteLength === 0) throw new Error("zero buffer");
      targetMemory.grow(0);
      targetMemory.grow(1);
    }
    Atomics.add(control, 3, 1);
  }
`;

for (let i = 0; i < kNumWorkers; i++) {
  new Worker(workerCode, {type: 'string'}).postMessage({targetMemory, kMaxGrows});
}

while (Atomics.load(control, 0) < kNumWorkers) {}
Atomics.store(control, 1, 1);
while (Atomics.load(control, 3) < kNumWorkers) {}

print("OK");
