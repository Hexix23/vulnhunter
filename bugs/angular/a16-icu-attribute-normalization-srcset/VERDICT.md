# A16 ICU Attribute Normalization And `srcset`

IMPACT_CLASS: `SECURITY_LOGIC`

VERDICT: `CONFIRMED_BOUNDED_PRIMITIVE / REFUTED_BYPASS`

## Summary

This pass expanded `GHSA-prjf-86w9-mfqv` beyond A10 by checking whether the ICU allowlist fix can
be bypassed through parser normalization or namespace tricks.

The actual bypass candidates were refuted:

- uppercase `href` is normalized and blocked as `unsafe:blocked`.
- whitespace before `=` still produces `href` / `src` and is blocked.
- null-byte and entity-spelled attribute names become unknown and are dropped.
- uppercase `xlink:href` is normalized and blocked as `unsafe:blocked`.
- `style`, `iframe/srcdoc`, and SVG parser-mutation shapes are dropped by the element/attribute allowlist.

The only surviving primitive is the already-known `srcset` class:

- `picture/source[srcset]`
- `img[srcset]`
- `video/source[srcset]`

Browser validation confirmed image fetches only. A `javascript:` candidate in `srcset` did not
execute in Chrome 147.

## Code Boundary

The current guard is in:

- `packages/core/src/render3/i18n/i18n_parse.ts:800-843`
- `packages/core/src/sanitization/html_sanitizer.ts:38-127`

The fix's allowlist model works for the tested executable/URI bypass shapes. `srcset` remains
allowed because it is in `VALID_ATTRS` and not in `SENSITIVE_ATTRS`, consistent with Angular's
existing HTML sanitizer posture.

## Evidence

- `poc/a16_icu_attribute_normalization_probe.patch`
- `poc/browser_srcset_impact_probe.mjs`
- `evidence/2026-04-29-render3-a16-normalization-matrix.md`
- `evidence/2026-04-29-browser-srcset-impact.json`
- `evidence/2026-04-29-browser-srcset-impact.md`

## Reportability

Not a new VRP report candidate.

The original ICU XSS class appears closed for the tested parser-normalization and executable DOM
creation variants. The residual `srcset` behavior is bounded to image/resource fetch and does not
meet the current reportability bar.

## Phase 1 Status For This CVE

`GHSA-prjf-86w9-mfqv` can be treated as closed for Phase 1:

- A10: `srcset` residual confirmed, bounded.
- A16: normalization/namespace bypasses refuted, `srcset` browser impact bounded.
