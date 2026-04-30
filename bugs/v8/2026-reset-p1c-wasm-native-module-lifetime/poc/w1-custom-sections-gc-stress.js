// Flags: --allow-natives-syntax --expose-gc

function assertEquals(expected, actual) {
  if (expected !== actual) {
    throw new Error(`expected ${expected}, got ${actual}`);
  }
}

function uleb(n) {
  const out = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return out;
}

function bytes(s) {
  return Array.from(s, c => c.charCodeAt(0));
}

function custom(name, payload) {
  const nameBytes = bytes(name);
  const body = [...uleb(nameBytes.length), ...nameBytes, ...payload];
  return [0, ...uleb(body.length), ...body];
}

function buildModule(sectionCount, payloadSize) {
  const out = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
  for (let i = 0; i < sectionCount; i++) {
    const payload = new Array(payloadSize);
    for (let j = 0; j < payload.length; j++) payload[j] = (i + j) & 0xff;
    out.push(...custom("target", payload));
    out.push(...custom("noise" + i, [i & 0xff]));
  }
  return new Uint8Array(out);
}

const bytes1 = buildModule(128, 257);
let module = new WebAssembly.Module(bytes1);

for (let r = 0; r < 200; r++) {
  const sections = WebAssembly.Module.customSections(module, "target");
  assertEquals(128, sections.length);
  for (let i = 0; i < sections.length; i += 17) {
    const view = new Uint8Array(sections[i]);
    assertEquals(257, view.length);
    assertEquals(i & 0xff, view[0]);
    assertEquals((i + 256) & 0xff, view[256]);
  }
  if (r % 5 === 0) gc();
  for (let k = 0; k < 5000; k++) ({ k, v: k + 1 });
}

module = null;
gc();
