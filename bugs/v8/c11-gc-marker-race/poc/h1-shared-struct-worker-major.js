// C11-H1: client isolate writes into a shared-heap object while main isolate
// repeatedly starts major/shared marking. This targets shared marking barrier
// activation/deactivation and the client-side shared worklist path.

function assertEq(got, expected, label) {
  if (got !== expected) {
    throw new Error(label + ": got " + got + ", expected " + expected);
  }
}

function assertTrue(value, label) {
  if (!value) throw new Error(label);
}

if (this.Worker) {
  const Box = new SharedStructType(["payload", "seq"]);
  const box = new Box();
  const ctrl = new Int32Array(new SharedArrayBuffer(4));

  const sharedA = %ShareObject("major-marker-race-A-" + "x".repeat(1024));
  const sharedB = %ShareObject("major-marker-race-B-" + "y".repeat(1024));
  assertTrue(%IsSharedString(sharedA), "sharedA");
  assertTrue(%IsSharedString(sharedB), "sharedB");

  box.payload = sharedA;
  box.seq = 0;

  const workerScript = `
    onmessage = function({data}) {
      const box = data.box;
      const ctrl = new Int32Array(data.ctrl);
      const a = data.a;
      const b = data.b;
      let i = 0;
      let trash = [];
      while (Atomics.load(ctrl, 0) === 0) {
        box.payload = (i & 1) ? a : b;
        Atomics.store(box, "seq", i);
        if ((i & 127) === 0) {
          trash.push("worker-trash-" + i + "-".repeat(64));
          if (trash.length > 2048) trash = [];
        }
        i++;
      }
      postMessage({done: i, seq: Atomics.load(box, "seq")});
    };
    postMessage("ready");
  `;

  const worker = new Worker(workerScript, {type: "string"});
  assertEq(worker.getMessage(), "ready", "worker ready");
  worker.postMessage({box, ctrl: ctrl.buffer, a: sharedA, b: sharedB});

  let trash = [];
  for (let round = 0; round < 64; round++) {
    for (let i = 0; i < 512; i++) {
      trash.push({round, i, value: "main-trash-" + round + "-" + i});
    }
    if (trash.length > 8192) trash = trash.slice(-1024);
    gc();
    %SharedGC();
    assertTrue(%IsSharedString(box.payload), "payload remains shared");
    assertTrue(String(box.payload).startsWith("major-marker-race-"),
               "payload content remains valid");
  }

  Atomics.store(ctrl, 0, 1);
  const done = worker.getMessage();
  assertTrue(done.done > 0, "worker made progress");
  worker.terminate();
}

print("OK");
