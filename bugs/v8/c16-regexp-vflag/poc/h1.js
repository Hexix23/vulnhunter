function probe(name, value) {
  print(name + ': ' + String(value));
}

// U+10400 DESERET CAPITAL LETTER LONG I
// U+10428 DESERET SMALL LETTER LONG I
probe('single astral raw', /[\q{𐐀}]/vi.test('𐐨'));
probe('single astral escape', /[\q{\u{10400}}]/vi.test('𐐨'));
probe('astral intersection raw', /[\q{𐐀|X}&&\q{𐐨}]/vi.test('𐐨'));
probe('astral intersection escape', /[\q{\u{10400}|X}&&\q{\u{10428}}]/vi.test('𐐨'));
probe('astral subtraction raw', /[\q{𐐀|X}--\q{𐐨}]/vi.test('𐐨'));
probe('astral subtraction escape', /[\q{\u{10400}|X}--\q{\u{10428}}]/vi.test('𐐨'));
