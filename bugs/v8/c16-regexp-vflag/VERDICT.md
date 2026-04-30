# C16.S8 Verdict

## H1 - astral string members case-fold incorrectly in `/vi`

Verdict: `REFUTED`

Evidence: `evidence/h1.txt`

Observed behavior:
- Raw astral string members and `\u{...}` spellings matched identically under `/vi`.
- Intersection and subtraction behaved identically in ASan and Release.

Protective path:
- `src/regexp/regexp-parser.cc:2642-2683` folds each class-string code point with `u_foldCase` before adding it.
- `src/regexp/regexp-parser.cc:2628-2637` reduces single-code-point class-string members to character ranges, avoiding a separate multi-code-point string path for astral singletons.
- `src/regexp/regexp-parser.cc:1985-2014` uses the same code-point iteration and folding strategy for string members extracted from ICU UnicodeSets.

## H2 - raw vs escaped surrogate-pair spellings diverge in membership or longest-match behavior

Verdict: `REFUTED`

Evidence: `evidence/h2.txt`

Observed behavior:
- Raw astral member, `\u{10400}`, and `\uD801\uDC00` all matched the same subject.
- Longest-match behavior remained identical for raw and escaped spellings.

Protective path:
- `src/regexp/regexp-parser.cc:1938-1943` combines escaped lead+trail surrogates into a single code point during unicode escape parsing.
- `src/regexp/regexp-parser.cc:164-183` then feeds that code point through the normal Unicode character path.

## H3 - escaped surrogate-pair class strings are misclassified as multi-code-point strings, causing negation differences

Verdict: `REFUTED`

Evidence: `evidence/h3.txt`

Observed behavior:
- Negated classes compiled successfully for raw astral, `\u{10400}`, and escaped surrogate-pair spellings, both with and without `/i`.
- No spelling-specific syntax split was observed.

Protective path:
- `src/regexp/regexp-parser.cc:1938-1943` canonicalizes escaped surrogate pairs early.
- `src/regexp/regexp-parser.cc:2628-2637` treats a normalized single code point as a range member rather than a string member.

## H4 - ICU loose matching allows non-exact `\p{...}` aliases through

Verdict: `REFUTED`

Evidence: `evidence/h4.txt`

Observed behavior:
- Exact aliases such as `\p{sc=Grek}`, `\p{Script=Greek}`, and `\p{Basic_Emoji}` compiled.
- Lowercase or punctuation-relaxed spellings were rejected with `SyntaxError`.

Protective path:
- `src/regexp/regexp-parser.cc:1955-1982` enforces exact property and property-value aliases.
- `src/regexp/regexp-parser.cc:2032-2036` rejects ICU loose matches that are not exact aliases.
- `src/regexp/regexp-parser.cc:2250-2252` and `:2275-2285` route property-name parsing through those exact checks.

## H5 - mixed string/range set algebra loses an arm

Verdict: `REFUTED`

Evidence:

- `evidence/h5-release.txt`
- `evidence/h5-asan.txt`
- `evidence/h5-interpret.txt`

Observed behavior:

- `[\q{ab|a}]` matched both `a` and `ab`.
- `[\q{ab|a}--a]` removed only the single-character range and kept `ab`.
- `[\q{ab|a}--\q{ab}]` removed only the string and kept `a`.
- intersections with `a` and `\q{ab}` selected the expected side.
- longest-match remained `ab`.

Protective path:

- `src/regexp/regexp-parser.cc:2628-2637` splits single-code-point `\q`
  alternatives into ranges and multi-code-point alternatives into strings.
- `src/regexp/regexp-parser.cc:2842-2951` preserves pending ranges/strings as
  class-set operands during union parsing.

## H6 - negated class static semantics around strings are unsound

Verdict: `REFUTED`

Evidence:

- `evidence/h6-release.txt`
- `evidence/h6-asan.txt`
- `evidence/h6-interpret.txt`

Observed behavior:

- direct negated string class throws `SyntaxError`.
- negated subtraction where first operand may contain strings throws.
- negated intersection that cannot contain strings compiles and behaves as a
  character-only complement.
- negated subtraction with character first compiles and behaves as expected.

Protective path:

- `src/regexp/regexp-parser.cc:2937-2939` rejects negated union when result may
  contain strings.
- `src/regexp/regexp-parser.cc:2961-2984` computes intersection
  `may_contain_strings` by requiring all operands to contain strings.
- `src/regexp/regexp-parser.cc:3000-3004` checks only the subtraction first
  operand, matching static-semantics comments in local tests.

## H7 - property-of-strings set operations diverge between regexp JIT and interpreter

Verdict: `REFUTED`

Evidence:

- `evidence/h7-release.txt`
- `evidence/h7-asan.txt`
- `evidence/h7-interpret.txt`

Observed behavior:

- `\p{Emoji_Keycap_Sequence}` matched keycap strings, not raw digits.
- subtraction/intersection with exact `\q{1\uFE0F\u20E3}` behaved correctly.
- `\p{RGI_Emoji_Flag_Sequence}` and `\p{RGI_Emoji_Tag_Sequence}` union matched
  flag/tag sequences.
- subtracting raw black flag from tag sequences preserved full tag sequence.
- `\p{RGI_Emoji}` longest-match returned the full tag sequence (`length=14`,
  tags invisible in terminal rendering).

Protective path:

- `src/regexp/regexp-parser.cc:1985-2014` extracts ICU UnicodeSet strings and
  builds both normalized string keys and regexp AST terms.
- `src/regexp/regexp-parser.cc:2044-2050` extracts strings before removing
  strings from range sets.

## H8 - runtime tiering diverges on large property-of-strings sets

Verdict: `REFUTED`

Evidence:

- `evidence/h8-release.txt`
- `evidence/h8-asan.txt`
- `evidence/h8-interpret.txt`
- `evidence/h8-tier-trace.txt`

Observed behavior:

- `\p{RGI_Emoji}`, `Emoji_Keycap_Sequence`, `RGI_Emoji` subtraction, and
  `RGI_Emoji && Emoji_Keycap_Sequence` agreed across release, ASAN, and
  `--regexp-interpret-all`.
- Longest-match behavior for mixed property-of-strings plus `\q{...}` remained
  stable.
- `--trace-regexp-tier-up` shows very large generated regexp bytecode for RGI
  emoji cases (`219136` and `219028` bytes), followed by tier-up/native-code
  execution, without crash or mismatch.

Interpretation:

This covers the runtime/JIT gap left by H1-H7. The high bytecode size is
expected for large string properties and did not expose memory safety behavior in
this matrix.

## H9 - excessive-backtracking fallback boundary with `/v` string members

Verdict: `REFUTED`

Evidence:

- `evidence/h9-release.txt`
- `evidence/h9-asan.txt`
- `evidence/h9-interpret.txt`
- `evidence/h9-fallback-trace.txt`

Observed behavior:

- Nested quantifiers over `\q{a|aa|...}` and mixed
  `Emoji_Keycap_Sequence + \q{...}` agreed across release, ASAN, and regexp
  interpreter.
- Capture boundaries for property-of-strings sequences were preserved.
- With `--enable-experimental-regexp-engine-on-excessive-backtracks`, V8
  explicitly reports these `/v` string-property patterns as unsupported by the
  experimental engine and stays on Irregexp; behavior still matches.

Interpretation:

No fallback-confusion bug was found. The main useful signal is that `/v` string
properties are outside the experimental fallback path, so future performance or
stack-limit work here must be treated as Irregexp-specific, not fallback-chain
specific.

## Overall

Verdict: `REFUTED` for H1-H9.

This `C16` slice did not produce a crash, ASan-only failure, matcher divergence,
or obvious spec violation. Direct parser invariants around astral class-string
handling, exact property aliasing, mixed string/range set algebra, negated
string static semantics, property-of-strings set operations, runtime tiering, and
experimental-fallback boundary behavior held for the probed cases.

Do not treat this as full C16 closure. Remaining valuable paths are broader
Unicode-version boundary cases and targeted Irregexp backtracking-stack/codegen
stress. The ordinary generated test262 set-algebra gap is already covered by
`bugs/v8/c17-regexp-unicodesets-generated/`.
