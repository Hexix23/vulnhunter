# Pre-Probe Card: A15 i18n ResourceURL Tag Matrix

Target: Angular framework i18n translated attribute sanitizer

Phase: CVE-derived

Prior CVE class: i18n XSS / sanitizer bypass

Advisory/fix source:
- GHSA-g93w-mfhg-p222 / CVE-2026-32635
- Fix commits: `b89b0a83a4`, `621c7071ad`

Fix diff files:
- `packages/core/src/render3/i18n/i18n_parse.ts`
- `packages/core/src/sanitization/html_sanitizer.ts`
- `packages/core/test/acceptance/i18n_spec.ts`
- `packages/core/test/acceptance/security_spec.ts`

Invariant:
- A translated attribute binding must preserve the same security context as the equivalent non-i18n binding.
- `RESOURCE_URL` sinks must not be downgraded to generic URL sanitization merely because the runtime only sees the attribute name.

Entry point:
- Direct `i18n-*` attribute interpolation, e.g. `<iframe src="{{url}}" i18n-src>`.

Trust boundary:
- App/user/translation-controlled string -> Angular compiler i18n metadata -> runtime i18n update opcode -> DOM resource-loading attribute.

High-risk operation:
- Runtime sanitizer selection in `i18nAttributesFirstPass()` and translated attribute opcode generation.

Attacker model:
- Web attacker controls data rendered by an Angular app into translated attributes. No `DomSanitizer`, no `bypassSecurityTrust*`, no manual DOM writes.

Sink:
- `RESOURCE_URL` pairs from `packages/compiler/src/schema/dom_security_schema.ts`: `base|href`, `embed|src`, `frame|src`, `iframe|src`, `link|href`, `object|codebase`, `object|data`, `script|src`, `script|href`, `script|xlink:href`.

Attacker-controlled value:
- `https://attacker.example/resource` and a `javascript:` negative control.

Expected violation:
- If direct i18n uses `_sanitizeUrl` instead of `ɵɵsanitizeResourceUrl`, plain `https:` values may be accepted where normal Angular binding throws `NG0904`.

Canonical runtime:
- Angular framework acceptance test target with JIT template compilation and real Angular runtime i18n instructions.

Oracle:
- Normal interpolation throws `NG0904`.
- Direct `i18n-*` either compiler-rejects as trusted sink, renders a useful DOM attribute, or renders no useful attribute.

Reportability bar:
- Report candidate only if a normal Angular template can render/fetch/execute a high-impact resource sink by default. A mere schema mismatch with no browser-relevant sink remains a bounded primitive.

Stop condition:
- Stop after all `RESOURCE_URL` tag/attribute pairs are either compiler-rejected, inert/no-value, already covered by A4, or browser-impactful.
