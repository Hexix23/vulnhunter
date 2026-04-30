function probe(name, fn) {
  try {
    print(name + ': ' + String(fn()));
  } catch (e) {
    print(name + ': THROW ' + e.name + ' ' + e.message);
  }
}

probe('raw pair member', () => /[\q{𐐀}]/v.test('𐐀'));
probe('escaped codepoint member', () => /[\q{\u{10400}}]/v.test('𐐀'));
probe('escaped surrogate pair member', () => /[\q{\uD801\uDC00}]/v.test('𐐀'));
probe('raw pair longest match', () => /[\q{𐐀|𐐀𐐨}]/v.exec('𐐀𐐨z')[0]);
probe('escaped pair longest match', () => /[\q{\u{10400}|\u{10400}\u{10428}}]/v.exec('𐐀𐐨z')[0]);
