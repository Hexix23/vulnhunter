# C17 RegExp UnicodeSets Generated Oracle

Date: 2026-04-28

Target:

- `src/regexp/regexp-parser.cc`
- `src/regexp/regexp-compiler-tonode.cc`
- local test262 generated `built-ins/RegExp/unicodeSets/generated/*.js`

## H1 - skipped generated UnicodeSets tests expose set-operation divergence

Status: `REFUTED`

Evidence:

- `evidence/generated-summary.txt`

Result:

- 114 generated UnicodeSets tests were executed directly with d8 release and
  the test262 harness files:
  - `sta.js`
  - `assert.js`
  - `regExpUtils.js`
- 113 passed.
- 1 failed: `rgi-emoji-17.0.js`.

The passing tests include all generated set-operation combinations for:

- character vs character property escape;
- character/string literal combinations;
- property-of-strings escape union/intersection/difference;
- string literal union/intersection/difference;
- `rgi-emoji-13.1` through `rgi-emoji-16.0`.

This closes the previously missing broad test262 oracle for C16/C17 set
algebra on this local V8 revision.

## H2 - `RGI_Emoji` Unicode 17 mismatch

Status: `CONFIRMED-KNOWN-FAILURE / NOT VRP`

Evidence:

- `evidence/generated-summary.txt`
- ASAN direct run also fails without memory safety signal.

Observed:

```text
Test262Error: `\p{RGI_Emoji}` should match 👨🏻‍🐰‍👨🏼
```

Context:

- `test/test262/test262.status:998` labels this section "Tests that need
  Unicode 17.0 data".
- `test/test262/test262.status:1082` marks
  `built-ins/RegExp/unicodeSets/generated/rgi-emoji-17.0` as `[FAIL]`.
- `third_party/icu/version.json` reports ICU major version `77`.

Interpretation:

This is a known Unicode data-version mismatch, not a new V8 security finding.
It is useful as an oracle sanity check, but not reportable as a fresh VRP bug.

## Overall

Verdict: `C17-ROUND-CLOSED-NO-NEW-BUG`

This does not close all RegExp hunting. It does close the concrete gap noted in
the VRP coverage review: broader generated `unicodeSets` test262 differential
for parser/matcher set algebra.

Next RegExp work should move away from ordinary generated set algebra and into:

- regexp JIT stress for very large property-of-strings alternatives;
- backtracking/linear-engine fallback boundary with `/v` string properties;
- stale Unicode data in shipped features only if not already marked known in
  local `test262.status`.
