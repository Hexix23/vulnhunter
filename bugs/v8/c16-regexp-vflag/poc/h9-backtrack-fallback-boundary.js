// RegExp /v excessive-backtracking boundary with string class members.
// Run with and without experimental fallback flags; behavior must agree.

function fail(msg) { throw new Error(msg); }

function assertEquals(expected, actual, label) {
  if (expected !== actual) {
    fail(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertArrayEquals(expected, actual, label) {
  if (!actual || actual.length !== expected.length) {
    fail(`${label}: length mismatch`);
  }
  for (let i = 0; i < expected.length; i++) {
    if (actual[i] !== expected[i]) {
      fail(`${label}: expected[${i}]=${expected[i]}, got ${actual[i]}`);
    }
  }
}

const keycap1 = "1\uFE0F\u20E3";
const flagBE = "\u{1F1E7}\u{1F1EA}";

const ambiguousStringSet = /^(?:[\q{a|aa|aaa|aaaa|aaaaa}]+)+$/v;
const mixedStringProperty = /^(?:[\p{Emoji_Keycap_Sequence}\q{1|11|111|1111}]+)+$/v;
const captureBoundary = /^([\p{Emoji_Keycap_Sequence}\q{11|1}]+)(X)?$/v;

const negativeAscii = "a".repeat(12) + "b";
const positiveAscii = "a".repeat(12);
const negativeMixed = "1".repeat(10) + "Z";
const positiveMixed = keycap1 + "1111" + "11" + "1";

for (let i = 0; i < 12; i++) {
  assertEquals(false, ambiguousStringSet.test(negativeAscii), `ascii-neg/${i}`);
  assertEquals(true, ambiguousStringSet.test(positiveAscii), `ascii-pos/${i}`);
  assertEquals(false, mixedStringProperty.test(negativeMixed), `mixed-neg/${i}`);
  assertEquals(true, mixedStringProperty.test(positiveMixed), `mixed-pos/${i}`);
  assertArrayEquals([flagBE, flagBE, undefined],
                    /^([\p{RGI_Emoji_Flag_Sequence}]+)(X)?$/v.exec(flagBE),
                    `flag-capture/${i}`);
  assertArrayEquals(["11X", "11", "X"], captureBoundary.exec("11X"),
                    `capture-q/${i}`);
}

print("H9 PASS");
