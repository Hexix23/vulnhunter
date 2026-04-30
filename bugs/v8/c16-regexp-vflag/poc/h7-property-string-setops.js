// C16 H7: Unicode property-of-strings mixed with set operations.
// Uses ASCII escapes for keycap sequence: "1\uFE0F\u20E3".

const keycap1 = '1\uFE0F\u20E3';
const keycap2 = '2\uFE0F\u20E3';
const belgium = '\u{1F1E7}\u{1F1EA}';
const blackFlag = '\u{1F3F4}';
const tagWales = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}';

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
  print(`${name}: ${JSON.stringify(got)} length=${got === null ? -1 : got.length}`);
  if (got !== expected) throw new Error(`${name} got ${got}, expected ${expected}`);
}

check('keycap property', /^[\p{Emoji_Keycap_Sequence}]$/v,
      [keycap1, keycap2], ['1', '2', belgium]);
check('keycap subtract exact', /^[\p{Emoji_Keycap_Sequence}--\q{1\uFE0F\u20E3}]$/v,
      [keycap2], [keycap1, '1']);
check('keycap intersection exact', /^[\p{Emoji_Keycap_Sequence}&&\q{1\uFE0F\u20E3}]$/v,
      [keycap1], [keycap2, '1']);

check('flag union property', /^[\p{RGI_Emoji_Flag_Sequence}\p{RGI_Emoji_Tag_Sequence}]$/v,
      [belgium, tagWales], [blackFlag, 'GB']);
check('tag subtract black flag', /^[\p{RGI_Emoji_Tag_Sequence}--\q{\u{1F3F4}}]$/v,
      [tagWales], [blackFlag]);

first('rgi longest', /[\p{RGI_Emoji}]/v, tagWales + 'x', tagWales);
print('H7 DONE');
