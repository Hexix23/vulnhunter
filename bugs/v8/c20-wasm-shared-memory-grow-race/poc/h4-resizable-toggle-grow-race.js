const PAGE = 65536;
const memory = new WebAssembly.Memory({initial: 1, shared: true, maximum: 240});
const control = new Int32Array(memory.buffer, 0, 8);

const workerCode = `
  onmessage = ({data}) => {
    const memory = data.memory;
    const control = new Int32Array(memory.buffer, 0, 8);
    Atomics.add(control, 0, 1);
    while (Atomics.load(control, 1) === 0) {}
    for (let i = 0; i < data.rounds; i++) {
      try {
        if ((i & 7) === 0) memory.toResizableBuffer();
        if ((i & 7) === 4) memory.toFixedLengthBuffer();
        const old = memory.grow((i & 1) === 0 ? 1 : 0);
        const visible = memory.buffer.byteLength;
        if (old >= 0 && old * ${PAGE} > visible) Atomics.store(control, 4, 1);
      } catch (e) {
        Atomics.store(control, 5, 1);
      }
      Atomics.add(control, 2, 1);
    }
    Atomics.add(control, 3, 1);
  }
`;

const workers = 4;
const rounds = 70;
for (let i = 0; i < workers; i++) {
  new Worker(workerCode, {type: "string"}).postMessage({memory, rounds});
}

while (Atomics.load(control, 0) < workers) {}
Atomics.store(control, 1, 1);

let lastResizableLength = 0;
let lastCurrentLength = 0;
while (Atomics.load(control, 3) < workers) {
  const oldPages = memory.grow(0);
  const rbuf = memory.toResizableBuffer();
  const current = memory.buffer;
  const fbuf = memory.toFixedLengthBuffer();

  if (oldPages * PAGE > current.byteLength) {
    throw new Error("grow(0) beyond current buffer");
  }
  if (rbuf.byteLength < lastResizableLength) {
    throw new Error("resizable buffer length regressed");
  }
  if (current.byteLength < lastCurrentLength) {
    throw new Error("memory.buffer length regressed");
  }
  if (fbuf.byteLength < oldPages * PAGE) {
    throw new Error("fixed buffer shorter than grow(0) result");
  }
  lastResizableLength = rbuf.byteLength;
  lastCurrentLength = current.byteLength;
}

if (Atomics.load(control, 4) !== 0) throw new Error("worker saw stale visible buffer");
if (Atomics.load(control, 5) !== 0) throw new Error("worker caught unexpected exception");
print("OK");
