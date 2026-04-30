# Pre-Probe Card: A4 i18n Sensitive Attribute Sanitization

Target: Angular framework runtime i18n attribute binding sanitizer

Phase: CVE-derived

Impact class: `SECURITY_LOGIC`

Prior CVE class: CWE-79 XSS / sanitizer bypass in i18n attribute bindings

Advisory/fix source:

- GHSA-g93w-mfhg-p222 / CVE-2026-32635
- Fix commits observed locally:
  - `b89b0a83a4` `fix(core): sanitize translated attribute bindings with interpolations`
  - `621c7071ad` `fix(core): sanitize translated form attributes`

Fix diff files:

- `packages/core/src/render3/i18n/i18n_parse.ts`
- `packages/core/src/sanitization/html_sanitizer.ts`
- `packages/core/test/acceptance/i18n_spec.ts`
- `packages/core/test/acceptance/security_spec.ts`

Invariant:

- Any translated attribute binding/interpolation that targets a browser URL-bearing or otherwise security-sensitive attribute must receive the same sanitizer as the equivalent non-i18n binding.
- Runtime i18n sanitizer selection must preserve enough element/attribute context to avoid downgrading `RESOURCE_URL` sinks to generic URL sanitization.
- Translator-created static sensitive URI attributes must be rejected, not sanitized into active output.

Entry point:

- Templates using `i18n-<attr>` on security-sensitive attributes.
- Runtime i18n translated element/ICU content that contains bound or static attributes.

Trust boundary:

- Application/user/translation-controlled string -> Angular runtime i18n parser/opcode generation -> browser DOM attribute/property.

High-risk operation:

- Sanitizer function selection in i18n update opcode generation.
- Attribute allowlist/sensitive attribute classification independent of element tag.

Attacker model:

- Remote low-privileged attacker controls application data bound into a translated sensitive attribute, or translation/CMS supply chain controls localized message content.
- Victim loads the affected Angular app in a browser.

Sink:

- `packages/core/src/render3/i18n/i18n_parse.ts:385-392` direct `i18n-*` attribute update opcodes.
- `packages/core/src/render3/i18n/i18n_parse.ts:811-820` bound attributes inside translated elements/ICUs.
- `packages/core/src/render3/i18n/i18n_parse.ts:829-838` static sensitive attributes inside translated elements/ICUs.
- `packages/core/src/sanitization/html_sanitizer.ts:78-127` `VALID_ATTRS` / `SENSITIVE_ATTRS`.

Attacker-controlled value:

- Bound URL string such as `javascript:...`, `data:...`, or attacker-controlled remote URL.
- Translation-inserted attributes and ICU message fragments.

Expected violation:

- A tag/attribute pair that should be `RESOURCE_URL`, `ATTRIBUTE_NO_BINDING`, or rejected is handled only by `_sanitizeUrl` or allowed statically because i18n uses attribute-name-only classification.

Canonical runtime:

- Angular-owned browser acceptance tests under `//packages/core/test/acceptance`.
- Browser app validation for actual fetch/execution behavior of surviving attributes.

Oracle:

- Framework oracle: DOM attribute is not `unsafe:*` or rejected where equivalent non-i18n binding is sanitized/rejected.
- Browser oracle: surviving attribute causes script execution, navigation, form submission to attacker, or security-relevant resource load.

Reportability bar:

- `CONFIRMED_REPORT_CANDIDATE` if default Angular app code with realistic untrusted bound data reaches executable script/navigation/credential-impacting behavior.
- `CONFIRMED_BOUNDED_PRIMITIVE` if the value only causes non-executable resource loads or requires translation-supply-chain control without direct app-user impact.
- `REFUTED` if the candidate closes on `SENSITIVE_ATTRS` or compiler schema validation before the browser sink.

Stop condition:

- Stop a sub-branch after three aliases/forms of the same attribute close on the same `SENSITIVE_ATTRS` or schema guard.
- Continue if a tag-specific resource sink is reduced to attribute-only `_sanitizeUrl`.
