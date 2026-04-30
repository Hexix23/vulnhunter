// RegExp /v string-property runtime matrix.
// Compares behavior-sensitive cases across regexp interpreter/JIT/ASAN runs.

function fail(msg) { throw new Error(msg); }

function assertEquals(expected, actual, label) {
  if (expected !== actual) {
    fail(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertTrue(value, label) {
  if (value !== true) fail(`${label}: expected true, got ${String(value)}`);
}

function assertFalse(value, label) {
  if (value !== false) fail(`${label}: expected false, got ${String(value)}`);
}

const soccer = "\u26BD";
const keycap1 = "1\uFE0F\u20E3";
const flagBE = "\u{1F1E7}\u{1F1EA}";
const doctor = "\u{1F468}\u{1F3FE}\u200D\u2695\uFE0F";

const cases = [
  {
    name: "rgi-emoji-single",
    re: /^\p{RGI_Emoji}$/v,
    yes: [soccer, keycap1, flagBE, doctor],
    no: ["A", "1", "\u2695"],
  },
  {
    name: "keycap-property-plus-q",
    re: /^[\p{Emoji_Keycap_Sequence}\q{AB|A}]+$/v,
    yes: [keycap1, "A", "AB", "AB" + keycap1 + "A"],
    no: ["B", "1", "A1"],
  },
  {
    name: "rgi-subtract-literal",
    re: /^[\p{RGI_Emoji}--\q{1\uFE0F\u20E3}]$/v,
    yes: [soccer, flagBE, doctor],
    no: [keycap1, "1", "A"],
  },
  {
    name: "rgi-intersect-keycap",
    re: /^[\p{RGI_Emoji}&&\p{Emoji_Keycap_Sequence}]$/v,
    yes: [keycap1],
    no: [soccer, flagBE, doctor, "1"],
  },
  {
    name: "mixed-longest",
    re: /[\p{Emoji_Keycap_Sequence}\q{123|12|1}]/v,
    execInput: "123 " + keycap1,
    execExpected: "123",
  },
];

for (const tc of cases) {
  for (let i = 0; i < 250; i++) {
    if (tc.yes) {
      for (const s of tc.yes) assertTrue(tc.re.test(s), `${tc.name}/yes/${i}`);
    }
    if (tc.no) {
      for (const s of tc.no) assertFalse(tc.re.test(s), `${tc.name}/no/${i}`);
    }
    if (tc.execInput) {
      const match = tc.re.exec(tc.execInput);
      assertEquals(tc.execExpected, match && match[0], `${tc.name}/exec/${i}`);
    }
  }
}

print("H8 PASS");
