# C16.S8 Walkthrough

## Scope

This round targeted the least-covered `/v` parser corner after inspecting `test/mjsunit/regexp-unicode-sets.js`: astral class-string members under `/vi`, raw-vs-escaped surrogate spellings, and the exact-alias guard around `\p{...}` parsing.

Relevant source paths:
- `src/regexp/regexp-parser.cc:90-183`
- `src/regexp/regexp-parser.cc:1938-2014`
- `src/regexp/regexp-parser.cc:2231-2285`
- `src/regexp/regexp-parser.cc:2628-2683`

## What was probed

1. `poc/h1.js`
   Astral Deseret letters inside `\q{...}` string members under `/vi`, including intersection and subtraction.

2. `poc/h2.js`
   Raw astral spelling, `\u{...}` spelling, and escaped surrogate-pair spelling for direct membership and longest-match behavior.

3. `poc/h3.js`
   Structural classification check: if escaped surrogate-pair spellings were treated as multi-code-point strings, negated classes would diverge from raw astral spellings.

4. `poc/h4.js`
   Exact-alias enforcement for `\p{...}` names and values, specifically to test whether ICU loose matching leaks through parser validation.

5. `poc/h5-mixed-string-range-algebra.js`
   Mixed `\q{ab|a}` operand where `a` becomes a range and `ab` remains a
   string. Tested subtraction, intersection, and longest-match.

6. `poc/h6-negated-string-static-semantics.js`
   Negated class static-semantics checks for direct strings, subtraction, and
   intersection that proves no strings can remain.

7. `poc/h7-property-string-setops.js`
   Property-of-strings set operations using keycap, flag, tag, and RGI emoji
   properties. Compared release, ASAN, and `--regexp-interpret-all`.

8. `poc/h8-runtime-string-property-tiering.js`
   Runtime tiering matrix over large property-of-strings sets. Compared release,
   ASAN, `--regexp-interpret-all`, and `--trace-regexp-tier-up`.

9. `poc/h9-backtrack-fallback-boundary.js`
   Backtracking/fallback boundary for nested quantifiers over `/v` string class
   members. Compared release, ASAN, interpreter, and excessive-backtracking
   fallback flags.

## Result

All four hypotheses were refuted.

- `h1` showed identical behavior in ASan and Release for raw and escaped astral class-string members.
- `h2` showed no divergence in direct match or longest-match behavior.
- `h3` showed no syntax-level classification difference between raw astral and escaped surrogate-pair spellings.
- `h4` confirmed that non-exact property aliases are rejected, which blocks the most obvious loose-matching failure mode.
- `h5` preserved mixed range/string operands correctly.
- `h6` matched V8's own static-semantics comments for negated class sets with strings.
- `h7` matched across normal regexp execution and `--regexp-interpret-all`; no JIT/interpreter split.
- `h8` forced tiering on very large RGI emoji regexp bytecode and still matched
  interpreter/ASAN behavior.
- `h9` showed `/v` string-property patterns are not supported by the
  experimental excessive-backtracking engine; Irregexp behavior remained
  consistent across release, ASAN, and interpreter.

## Why the probes failed

- Escaped surrogate pairs are combined to a single code point early during Unicode escape parsing.
- Single-code-point class-string members are normalized into character ranges, so astral singletons do not stay in the more complex string-member path.
- Property names and values are checked against exact ICU aliases after enum lookup, preventing the parser from accepting lowercased or punctuation-relaxed spellings.

## Next follow-up

If we revisit `C16`, the next worthwhile sub-slice is not more surrogate spelling work. Better options are:

1. property-of-strings interactions under `/vi` with set operations, especially where the resulting set mixes string members and character ranges
2. a spec-diff pass against current test262 `/v` coverage rather than ad hoc parser probes
3. moving to a different priority candidate to preserve anti-anchoring diversity

Update after H5-H9: item 1 and runtime tiering have partial coverage now. The
ordinary generated test262 set-algebra gap is covered under
`bugs/v8/c17-regexp-unicodesets-generated/`. Best remaining `C16` work is narrow
Irregexp backtracking-stack/codegen stress or Unicode-version boundary review,
not more small hand-built set algebra.
