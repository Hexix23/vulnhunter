function compile(name, source, flags) {
  try {
    const re = new RegExp(source, flags);
    print(name + ': OK ' + re.source + '/' + re.flags);
  } catch (e) {
    print(name + ': THROW ' + e.name + ' ' + e.message);
  }
}

compile('negated raw astral', '[^\\q{𐐀}]', 'v');
compile('negated escaped codepoint', '[^\\q{\\u{10400}}]', 'v');
compile('negated escaped surrogates', '[^\\q{\\uD801\\uDC00}]', 'v');
compile('negated raw astral ignorecase', '[^\\q{𐐀}]', 'vi');
compile('negated escaped codepoint ignorecase', '[^\\q{\\u{10400}}]', 'vi');
compile('negated escaped surrogates ignorecase', '[^\\q{\\uD801\\uDC00}]', 'vi');
