# Pre-Probe Card: A16 ICU Attribute Normalization And `srcset`

Target: Angular runtime ICU/i18n DOM creation.

Phase: CVE-derived.

Prior CVE class: `GHSA-prjf-86w9-mfqv` / `CVE-2026-27970`, XSS in translated ICU HTML.

Advisory/fix source:
- Advisory: `https://github.com/angular/angular/security/advisories/GHSA-prjf-86w9-mfqv`
- Fix: `https://github.com/angular/angular/pull/67183`
- Local fix commit: `747548721d051c21e388a302d20d53fb3ab16367`

Fix diff files:
- `packages/core/src/render3/i18n/i18n_parse.ts`
- `packages/core/test/acceptance/i18n_spec.ts`
- `packages/core/test/render3/i18n/i18n_parse_spec.ts`

Invariant:
- ICU-created DOM may only contain allowlisted inert elements and attributes.
- Static URI-bearing attributes introduced by translation must be blocked regardless of parser normalization, case, namespace, or malformed spelling.
- Residual allowlisted attributes must not create script execution or high-impact browser behavior.

Entry point:
- Translated ICU case HTML parsed by `parseIcuCase()` and walked by `walkIcuTree()`.

Trust boundary:
- Translation file / translation supply chain -> Angular runtime i18n parser -> browser DOM.

High-risk operation:
- Inert HTML parsing followed by DOM create opcodes and static attribute create opcodes.

Attacker model:
- Malicious or compromised translator controls ICU translated HTML.
- No `DomSanitizer`, no `bypassSecurityTrust*`, no manual DOM writes.

Sink:
- `packages/core/src/render3/i18n/i18n_parse.ts:800-843`
- `packages/core/src/sanitization/html_sanitizer.ts:38-127`

Attacker-controlled value:
- Static ICU HTML attributes: case variants, namespace variants, malformed names, `srcset`, `srcdoc`, style, SVG/parser mutation payloads.

Expected violation:
- A URI-bearing attribute bypasses `SENSITIVE_ATTRS` due to parser normalization mismatch, or an allowlisted residual attribute causes script execution.

Canonical runtime:
- Angular render3 i18n parser test harness.
- Browser probe for `srcset` residual behavior in Chrome 147.

Oracle:
- DOM output blocks URI attrs as `unsafe:blocked` or drops unknown attrs/elements.
- Browser probe must show whether residual `srcset` executes script, fetches only images, or triggers stronger behavior.

Reportability bar:
- Report candidate only for XSS/script execution, credential leakage, navigation, or cross-user impact. Image/resource fetch alone is a bounded primitive.

Stop condition:
- All parser-normalization variants are blocked/dropped and residual `srcset` remains image-fetch-only.
