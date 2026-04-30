# A17 SVG `foreignObject` And MathML Namespace Transitions

IMPACT_CLASS: `SECURITY_LOGIC`

VERDICT: `REFUTED`

## Summary

This pass expanded `GHSA-v4hv-rgfq-gp49` beyond A11 by testing namespace transitions that could
lose sanitizer context:

- HTML descendants inside SVG `foreignObject`.
- MathML URL attributes on `semantics` and `maction`.
- MathML `annotation-xml` reachability.

No new exploitable gap was found.

## Findings

`foreignObject` is handled correctly by the compiler in the tested template. Generated code switches
from SVG to HTML namespace before creating descendants, and dangerous attributes keep the expected
guards:

- `a[href]` -> `ɵɵsanitizeUrl`
- `iframe[srcdoc]` -> `ɵɵsanitizeHtml`
- `iframe[sandbox]` -> `ɵɵvalidateAttribute`
- `div[style]` -> `ɵɵsanitizeStyle`
- `form[action]` -> `ɵɵsanitizeUrl`

MathML URL-bearing attributes also keep URL sanitization:

- `semantics[href]` / `semantics[xlink:href]` -> `ɵɵsanitizeUrl`
- `maction[href]` -> `ɵɵsanitizeUrl`

`annotation-xml` did not compile as a known MathML element in the tested normal-template shape,
so it does not reach runtime DOM creation through this path.

## Evidence

- `poc/a17_ngtsc_foreignobject_mathml_probe.patch`
- `evidence/2026-04-29-ngtsc-a17-namespace-generated-code.md`

## Reportability

Not reportable. This is a refutation of the namespace-transition sibling for the SVG/MathML schema
CVE. A11 remains the bounded hardening gap for SVG URL-ish attrs, but A17 did not identify a path
that escalates it to XSS, navigation, credential exposure, or meaningful browser impact.
