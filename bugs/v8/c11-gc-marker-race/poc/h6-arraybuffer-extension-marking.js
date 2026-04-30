// C11-H6: ArrayBufferExtension publication and resize/grow while major marking
// and concurrent array-buffer sweeping are stressed. The target contract is
// MarkingBarrier::Write(JSArrayBuffer, ArrayBufferExtension*) choosing Mark()
// vs YoungMark() correctly and not losing a native backing-store extension.

function assertEq(got, expected, label) {
  if (got !== expected) {
    throw new Error(label + ": got " + got + ", expected " + expected);
  }
}

function assertTrue(value, label) {
  if (!value) throw new Error(label);
}

async function churnResizable(round) {
  const holders = [];
  for (let i = 0; i < 512; i++) {
    const rab = new ArrayBuffer(32, {maxByteLength: 4096});
    const view = new Uint32Array(rab);
    view[0] = round ^ i;
    rab.resize(256 + ((i & 7) * 64));
    new Uint8Array(rab)[rab.byteLength - 1] = i & 255;
    if ((i & 3) === 0) {
      rab.resize(64);
      new Uint32Array(rab)[0] = round + i;
    }
    holders.push({rab, view});
  }
  await gc({type: "major", execution: "async"});
  for (let i = 0; i < holders.length; i += 17) {
    assertTrue(holders[i].rab.byteLength >= 64, "rab length");
    const expected = (i & 3) === 0 ? round + i : round ^ i;
    assertEq(new Uint32Array(holders[i].rab)[0], expected, "rab content");
  }
}

function churnGrowableShared(round) {
  const holders = [];
  for (let i = 0; i < 256; i++) {
    const gsab = new SharedArrayBuffer(64, {maxByteLength: 4096});
    const view = new Uint32Array(gsab);
    view[0] = round + i;
    gsab.grow(512 + ((i & 3) * 128));
    Atomics.store(view, 1, i);
    holders.push({gsab, view});
  }
  gc();
  %SharedGC();
  for (let i = 0; i < holders.length; i += 19) {
    assertTrue(holders[i].gsab.byteLength >= 512, "gsab length");
    assertEq(Atomics.load(holders[i].view, 0), round + i, "gsab content");
  }
}

async function main() {
  for (let round = 0; round < 24; round++) {
    await churnResizable(round);
    churnGrowableShared(round);
    if ((round & 3) === 0) {
      await gc({type: "minor", execution: "async"});
    }
  }
  print("OK");
}

main();
