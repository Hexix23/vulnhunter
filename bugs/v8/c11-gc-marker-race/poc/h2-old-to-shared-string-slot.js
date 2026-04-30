// C11-H2: old local object receives shared strings while shared/major marking
// is active. This targets OLD_TO_SHARED remembered-set creation and the shared
// heap write barrier path.

function assertTrue(value, label) {
  if (!value) throw new Error(label);
}

const shared = [];
for (let i = 0; i < 128; i++) {
  const s = %ShareObject("old-to-shared-" + i + "-" + "z".repeat(2048));
  assertTrue(%IsSharedString(s), "shared string " + i);
  shared.push(s);
}

let holder = {slot: shared[0], pad0: 1, pad1: 2, pad2: 3};

// Promote holder into old space.
for (let i = 0; i < 8; i++) gc();
assertTrue(!%InYoungGeneration(holder), "holder promoted");

let trash = [];
for (let round = 0; round < 256; round++) {
  holder.slot = shared[round & 127];
  if ((round & 7) === 0) {
    for (let i = 0; i < 512; i++) {
      trash.push({round, i, s: shared[(round + i) & 127]});
    }
    if (trash.length > 8192) trash = trash.slice(-1024);
  }
  if ((round & 15) === 0) gc();
  if ((round & 31) === 0) %SharedGC();
  assertTrue(%IsSharedString(holder.slot), "slot remains shared");
}

gc();
%SharedGC();
assertTrue(%IsSharedString(holder.slot), "final shared slot");
print("OK");
