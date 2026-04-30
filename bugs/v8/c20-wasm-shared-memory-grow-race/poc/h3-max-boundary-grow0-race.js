const PAGE = 65536;
const maximum = 64;
const memory = new WebAssembly.Memory({initial: 1, shared: true, maximum});
const control = new Int32Array(memory.buffer, 0, 8);

const workerCode = `
  onmessage = ({data}) => {
    const memory = data.memory;
    const control = new Int32Array(memory.buffer, 0, 8);
    Atomics.add(control, 0, 1);
    while (Atomics.load(control, 1) === 0) {}
    for (;;) {
      try {
        memory.grow(1);
        Atomics.add(control, 2, 1);
      } catch (e) {
        Atomics.add(control, 3, 1);
        break;
      }
      memory.grow(0);
    }
  }
`;

const workers = 4;
for (let i = 0; i < workers; i++) {
  new Worker(workerCode, {type: "string"}).postMessage({memory});
}

while (Atomics.load(control, 0) < workers) {}
Atomics.store(control, 1, 1);

let last = memory.buffer.byteLength;
while (Atomics.load(control, 3) < workers) {
  let old;
  try {
    old = memory.grow(0);
  } catch (e) {
    throw new Error("grow(0) threw: " + e);
  }
  const len = memory.buffer.byteLength;
  if (len < last) throw new Error("buffer length regressed near maximum");
  if (old * PAGE > len) throw new Error("grow(0) returned pages beyond buffer length");
  if (len > maximum * PAGE) throw new Error("buffer exceeded maximum");
  last = len;
}

if (memory.buffer.byteLength !== maximum * PAGE) {
  throw new Error("final buffer length mismatch: " + memory.buffer.byteLength);
}

print("OK");
