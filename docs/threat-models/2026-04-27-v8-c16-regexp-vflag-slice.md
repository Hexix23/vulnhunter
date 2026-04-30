# V8 C16 Slice - RegExp `/v` Differential

**Date:** 2026-04-27
**Candidate:** `C16.S8`
**Surface:** RegExp UnicodeSets (`/v`)
**Violated contract:** UnicodeSets string members, surrogate handling, and property escapes must produce the same membership and case-insensitive behavior the `/v` spec requires, including for non-BMP code points and string members.

## Working set

- `src/regexp/regexp-parser.cc:91-127`
  `TextBuilder` tracks pending surrogates and flushes lone halves under Unicode mode.
- `src/regexp/regexp-parser.cc:164-183`
  `AddUnicodeCharacter` and `AddEscapedUnicodeCharacter` treat raw and escaped surrogates differently.
- `src/regexp/regexp-parser.cc:1985-2014`
  `ExtractStringsFromUnicodeSet` builds string members and applies per-code-point case folding for `/vi`.
- `src/regexp/regexp-parser.cc:2017-2058`
  `LookupPropertyValueName` extracts property-of-strings members, then case-folds ranges separately.
- `src/regexp/regexp-parser.cc:2231-2283`
  `AddPropertyClassRange` handles binary and enumerated property escapes, including `/v`-specific string-property rules.

## Why this slice

`test/mjsunit/regexp-unicode-sets.js` already covers many BMP string-disjunction, emoji, and property-of-strings cases. The biggest remaining gap is **astral letters with case-folding** and **raw-vs-escaped surrogate construction** inside string members.

## Hypotheses

1. **H1 - astral string members case-fold incorrectly in `/vi`**
   `ExtractStringsFromUnicodeSet` folds one code point at a time and may diverge for supplementary-plane letters used inside `\q{...}` string members.

2. **H2 - raw surrogate pairs and escaped surrogate pairs are not equivalent in `/v` string members**
   `AddEscapedUnicodeCharacter` intentionally prevents escape-parsed halves from pairing with neighbors; a string member built from escapes may not behave like the same raw code point.

3. **H3 - intersection/subtraction on astral string members loses case-fold equivalence**
   The same logic that works for BMP examples may leave stale members for non-BMP folded equivalents.

## Initial probes

- `h1.js` - astral case-fold on Deseret string members.
- `h2.js` - raw vs escaped surrogate-pair equivalence inside `\q{...}`.
