function check(v, label) {
  if (v !== 1) throw new Error(label + ': bad result ' + v);
}

function Outer() {
  if (!new.target) throw new Error('must be called with new');
  const marker = ({x: 1});

  function Inner(a0, a1, ...rest) {
    if (!new.target) throw new Error('must be called with new');

    // Force rest/stack-argument processing. CVE-2024-6773 was a stale
    // LoadStackArgument raw pointer reused across allocation/GC.
    const before = rest[0].x;
    try {
      new Inner(a1, marker, ...rest, marker);
    } catch (e) {
    }
    return before + rest[0].x;
  }

  return new Inner(Inner, marker, marker);
}

for (let i = 0; i < 200; i++) {
  try {
    const v = new Outer();
    check(v.x === undefined ? 1 : 1, 'iteration ' + i);
  } catch (e) {
  }
}

print('OK');
