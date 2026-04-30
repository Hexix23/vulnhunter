# A11 - GHSA-v4hv-rgfq-gp49 DOM schema SVG/MathML/animation residuals

Target: `targets/angular`

Phase: CVE-derived

Prior CVE class: DOM security schema XSS. Advisory says the compiler missed SVG/MathML URL attributes and SVG animation `attributeName` indirection.

Advisory/fix source: GHSA-v4hv-rgfq-gp49. Public fix is not linked in the advisory, so this probe infers from current schema and runtime validator state.

Fix diff files: private/unknown. Current relevant files:
- `packages/compiler/src/schema/dom_security_schema.ts`
- `packages/compiler/src/template/pipeline/src/phases/resolve_sanitizers.ts`
- `packages/core/src/sanitization/sanitization.ts`
- `packages/compiler-cli/test/ngtsc/ngtsc_spec.ts`
- `packages/core/test/acceptance/security_spec.ts`

Invariant: Every browser-executable URL/resource sink, including namespace aliases and SVG animation attribute indirection, must map to the correct sanitizer or a runtime `validateAttribute` guard.

Entry point: Angular template, host binding, or directive binding compiled by Angular.

Trust boundary: Application/data-controlled string crosses from Angular binding expression into browser DOM attributes/properties.

High-risk operation: compiler security-context selection and runtime DOM attribute mutation.

Attacker model: Web attacker controls an application value bound into a template or directive host binding; app is otherwise ordinary Angular code and does not call `bypassSecurityTrust*`.

Sink: SVG/MathML URL attributes and SVG animation indirection attributes.

Attacker-controlled value: URL-like string (`javascript:...`, external URL, fragment), or animation payload that targets `href` / `xlink:href`.

Expected violation:
- H1: `<animate attributeName="href" [attr.by]="...">` compiles without `validateAttribute` and browser treats `by` as href-changing animation payload.
- H2: `<mpath [attr.href]="...">` or `[attr.xlink:href]` compiles without a sanitizer while browser resolves it as a URL-bearing SVG sink.
- H3: MathML namespace aliases or less common MathML elements produce `SecurityContext.NONE` for `href`/`xlink:href`.

Canonical runtime: Angular compiler output first; if a missing sanitizer/validator is confirmed, promote to a real browser Angular app probe.

Oracle:
- Generated code contains `ɵɵsanitizeUrl`, `ɵɵsanitizeResourceUrl`, `ɵɵsanitizeUrlOrResourceUrl`, or `ɵɵvalidateAttribute` for dangerous sinks.
- Runtime throws `NG0910` for forbidden animation attribute bindings.
- Browser probe demonstrates actual navigation/fetch/script/content impact before report-candidate escalation.

Reportability bar: VRP candidate only if ordinary Angular code reaches script execution, credential leak, attacker-controlled network fetch with meaningful data exposure, or cross-user content integrity impact. A missing sanitizer with no browser-impact path is a bounded primitive, not a report.

Stop condition: Once current schema/runtime guard blocks the original CVE class and residuals are either non-browser-effective or sanitized, mark this CVE closed for Phase 1 and move to the next CVE.
