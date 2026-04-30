// C16 H6: negated /v classes with strings are early errors unless set algebra
// proves result cannot contain strings.

function compile(name, source, flags, shouldCompile) {
  try {
    const re = new RegExp(source, flags);
    print(`${name}: OK ${re.source}/${re.flags}`);
    if (!shouldCompile) throw new Error(`${name} should have thrown`);
    return re;
  } catch (e) {
    print(`${name}: THROW ${e.name} ${e.message}`);
    if (shouldCompile) throw e;
    return null;
  }
}

function expect(name, re, s, expected) {
  const got = re.test(s);
  print(`${name}: ${JSON.stringify(s)} -> ${got}`);
  if (got !== expected) throw new Error(`${name} mismatch`);
}

compile('negated direct string', '[^\\q{ab}]', 'v', false);
compile('negated subtraction string first', '[^\\q{ab}--a]', 'v', false);

const re1 = compile('negated intersection no strings', '^[^\\q{ab|a}&&a]$', 'v', true);
expect('negated intersection no strings', re1, 'a', false);
expect('negated intersection no strings', re1, 'b', true);
expect('negated intersection no strings', re1, 'ab', false);

const re2 = compile('negated subtraction char first', '^[^a--\\q{ab}]$', 'v', true);
expect('negated subtraction char first', re2, 'a', false);
expect('negated subtraction char first', re2, 'b', true);
expect('negated subtraction char first', re2, 'ab', false);

print('H6 DONE');

