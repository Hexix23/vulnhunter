// C16 H5: /v class-set algebra when one operand contributes both ranges
// (single-code-point \q alternatives) and strings (multi-code-point alternatives).

function check(name, re, yes, no) {
  for (const s of yes) {
    if (!re.test(s)) throw new Error(`${name} should match ${JSON.stringify(s)}`);
  }
  for (const s of no) {
    if (re.test(s)) throw new Error(`${name} should not match ${JSON.stringify(s)}`);
  }
  print(`${name}: OK`);
}

function first(name, re, subject, expected) {
  const got = re.exec(subject)?.[0] ?? null;
  print(`${name}: ${JSON.stringify(got)}`);
  if (got !== expected) throw new Error(`${name} got ${got}, expected ${expected}`);
}

check('union mixed', /^[\q{ab|a}]$/v, ['a', 'ab'], ['b', 'aa']);
check('subtract range keeps string', /^[\q{ab|a}--a]$/v, ['ab'], ['a', 'b']);
check('subtract string keeps range', /^[\q{ab|a}--\q{ab}]$/v, ['a'], ['ab', 'b']);
check('intersection range', /^[\q{ab|a}&&a]$/v, ['a'], ['ab', 'b']);
check('intersection string', /^[\q{ab|a}&&\q{ab}]$/v, ['ab'], ['a', 'b']);
first('longest mixed', /[\q{ab|a}]/v, 'ab', 'ab');
first('longest after subtract range', /[\q{ab|a}--a]/v, 'ab', 'ab');
print('H5 DONE');

