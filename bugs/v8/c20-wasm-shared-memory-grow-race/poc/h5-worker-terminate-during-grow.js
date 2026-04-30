const PAGE = 65536;
const memory = new WebAssembly.Memory({initial: 1, shared: true, maximum: 700});
const control = new Int32Array(memory.buffer, 0, 16);

const workerCode = `
  onmessage = ({data}) => {
    const memory = data.memory;
    const control = new Int32Array(memory.buffer, 0, 16);
    Atomics.add(control, 0, 1);
    while (Atomics.load(control, 1) === 0) {}
    for (let i = 0; i < 5000; i++) {
      try {
        if ((i & 3) === 0) memory.grow(1);
        else memory.grow(0);
        const pages = memory.grow(0);
        const b = memory.buffer;
        if (pages * ${PAGE} > b.byteLength) Atomics.store(control, 4, 1);
      } catch (e) {
        Atomics.add(control, 5, 1);
      }
    }
    Atomics.add(control, 2, 1);
  }
`;

function spawn() {
  const w = new Worker(workerCode, {type: "string"});
  w.postMessage({memory});
  return w;
}

let workers = [];
for (let i = 0; i < 8; i++) workers.push(spawn());
while (Atomics.load(control, 0) < 8) {}
Atomics.store(control, 1, 1);

let last = 0;
for (let i = 0; i < 500; i++) {
  const victim = i % workers.length;
  workers[victim].terminate();
  workers[victim] = spawn();

  try {
    if ((i & 1) === 0) memory.grow(1);
    const pages = memory.grow(0);
    const len = memory.buffer.byteLength;
    if (pages * PAGE > len) throw new Error("main saw stale buffer");
    if (len < last) throw new Error("main buffer length regressed");
    last = len;
  } catch (e) {
    const msg = String(e);
    if (!msg.includes("Maximum memory size exceeded") &&
        !msg.includes("Unable to grow instance memory")) throw e;
  }
}

for (const w of workers) w.terminate();
if (Atomics.load(control, 4) !== 0) throw new Error("worker saw stale buffer");
print("OK");
