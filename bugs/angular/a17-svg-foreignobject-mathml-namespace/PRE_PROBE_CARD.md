# Pre-Probe Card: A17 SVG `foreignObject` And MathML Namespace Transitions

Target: Angular compiler DOM security schema and namespace handling.

Phase: CVE-derived.

Prior CVE class: `GHSA-v4hv-rgfq-gp49`, SVG/MathML DOM schema XSS.

Advisory/fix source:
- Advisory: `https://github.com/angular/angular/security/advisories/GHSA-v4hv-rgfq-gp49`
- Public fix files unavailable.

Fix diff files: private/unknown.

Current relevant files:
- `packages/compiler/src/schema/dom_security_schema.ts`
- `packages/core/src/sanitization/sanitization.ts`
- `packages/compiler/src/ml_parser/html_tags.ts`
- `packages/compiler-cli/test/ngtsc/ngtsc_spec.ts`

Invariant:
- Namespace transitions must not lose security context.
- HTML children inside SVG `foreignObject` must receive HTML sanitizers.
- MathML URL-bearing attributes must receive URL sanitizers.

Entry point:
- Normal Angular template bindings and attribute bindings.

Trust boundary:
- Application/user-controlled string -> Angular compiler security context -> browser DOM namespace sink.

High-risk operation:
- Compiler namespace tracking and sanitizer selection for mixed SVG/HTML/MathML templates.

Attacker model:
- Web attacker controls data bound into an ordinary Angular component template.
- App does not use `DomSanitizer.bypassSecurityTrust*` and does not manually write DOM.

Sink:
- `foreignObject` HTML descendants: `href`, `srcdoc`, `sandbox`, `style`, `form action`.
- MathML descendants: `semantics|href/xlink:href`, `maction|href`.
- `annotation-xml` reachability.

Attacker-controlled value:
- `javascript:` URL, HTML string, iframe sandbox policy, style URL, MathML action type.

Expected violation:
- A mixed-namespace element compiles without the sanitizer/validator that the equivalent HTML or MathML element requires.

Canonical runtime:
- Angular `ngtsc` generated-code oracle first.
- Browser/app validation only if a sanitizer is missing or downgraded.

Oracle:
- Generated code must contain `ɵɵsanitizeUrl`, `ɵɵsanitizeHtml`, `ɵɵsanitizeStyle`, or `ɵɵvalidateAttribute` for dangerous mixed-namespace sinks.
- `annotation-xml` either compiles with URL sanitizers or is rejected before DOM creation.

Reportability bar:
- Report candidate only if a normal Angular template reaches script execution, navigation, credential leak, or a meaningful browser side effect without explicit bypass APIs.

Stop condition:
- Mixed namespace sinks are sanitized/validated or compiler-rejected.
