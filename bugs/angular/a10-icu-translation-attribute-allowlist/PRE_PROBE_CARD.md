# A10 ICU Translation Attribute Allowlist

Target: Angular framework, `@angular/core` i18n runtime parser.

Phase: CVE-derived.

Prior CVE class: `GHSA-prjf-86w9-mfqv` / `CVE-2026-27970`, XSS in Angular i18n ICU translated HTML.

Advisory/fix source:

- Advisory: `https://github.com/angular/angular/security/advisories/GHSA-prjf-86w9-mfqv`
- Fix: `https://github.com/angular/angular/pull/67183`
- Local fix commit: `747548721d051c21e388a302d20d53fb3ab16367`

Fix diff files:

- `packages/core/src/render3/i18n/i18n_parse.ts`
- `packages/core/test/acceptance/i18n_spec.ts`
- `packages/core/test/render3/i18n/i18n_parse_spec.ts`

Invariant:

- Translated ICU HTML may create only allowlisted inert elements and attributes.
- Translated ICU HTML must not create URI-bearing attributes from static translator-controlled text.
- ICU attributes with bindings must use the same sanitizer class the equivalent template binding would use.

Entry point:

- Translated ICU case HTML parsed by `parseIcuCase()`.

Trust boundary:

- Translation file / translation contractor to browser DOM mutation runtime.

High-risk operation:

- Inert HTML parsing followed by runtime DOM node and attribute creation.

Attacker model:

- Translation/supply-chain attacker can alter translated ICU message content.
- Application may have bindings referenced by ICU placeholders.

Sink:

- `walkIcuTree()` attribute handling in `packages/core/src/render3/i18n/i18n_parse.ts:800-843`.
- `addCreateAttribute()` runtime create opcode.
- `generateBindingUpdateOpCodes()` sanitizer argument for attributes with placeholder bindings.

Attacker-controlled value:

- Static ICU HTML attributes introduced by translation.
- Placement of existing Angular i18n binding placeholders into ICU-created attributes.

Expected violation:

- A translator-controlled ICU attribute not covered by `SENSITIVE_ATTRS` but still security-relevant survives into DOM or causes browser side effects.
- Or a bound ICU attribute uses `_sanitizeUrl` where normal template compilation would require a stricter sanitizer.

Canonical runtime:

- Angular's own render3 i18n parser test harness first.
- If a browser-relevant primitive survives, promote to compiled Angular app/browser validation.

Oracle:

- DOM output contains a translator-introduced security-relevant attribute that should have been blocked.
- Browser or runtime side effect: fetch, navigation, script execution, or sanitizer mismatch compared with equivalent non-i18n template binding.

Reportability bar:

- Report candidate only if there is XSS, credential leakage, browser-executed code, or a security-relevant default browser side effect beyond image/resource fetch.
- Otherwise mark as primitive or refuted and continue CVE queue.

Stop condition:

- Guard blocks before DOM creation.
- Only benign resource fetch / image load is observed.
- The residual collapses to already-known A4 `link|href` ResourceURL downgrade.
