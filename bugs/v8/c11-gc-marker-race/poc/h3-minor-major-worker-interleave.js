// C11/C12-H3: interleave minor marking pressure, major/shared GC, and worker
// isolate startup/shutdown. This targets page marking flag consistency and
// ActivateYoung/ActivateAll ordering.

function assertTrue(value, label) {
  if (!value) throw new Error(label);
}

if (this.Worker) {
  const workerFn = function() {
    let keep = [];
    for (let i = 0; i < 3000; i++) {
      keep.push(new Uint32Array(16));
      if ((i & 255) === 0) {
        keep = keep.slice(-128);
        gc();
      }
    }
    postMessage("done");
  };

  let local = [];
  for (let round = 0; round < 32; round++) {
    const worker = new Worker(workerFn, {type: "function"});
    for (let i = 0; i < 1024; i++) {
      local.push({round, i, buf: new Uint32Array(8)});
    }
    local = local.slice(-2048);
    gc();
    if ((round & 3) === 0) %SharedGC();
    assertTrue(worker.getMessage() === "done", "worker done");
    worker.terminate();
  }
}

print("OK");
