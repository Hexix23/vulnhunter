# A15 i18n ResourceURL Tag Matrix

IMPACT_CLASS: `SECURITY_LOGIC`

VERDICT: `REFUTED_HIGH_IMPACT_VARIANT / A4_REMAINS_BOUNDED_PRIMITIVE`

## Summary

This probe expanded `GHSA-g93w-mfhg-p222` from the known A4 `link|href` residual into the full
`RESOURCE_URL` tag matrix.

The high-impact candidates do not produce a reportable bypass in current Angular:

- `iframe|src`: normal interpolation throws `NG0904`; direct `i18n-src` is compiler-rejected.
- `embed|src`: normal interpolation throws `NG0904`; direct `i18n-src` is compiler-rejected.
- `object|data`: normal interpolation throws `NG0904`; direct `i18n-data` is compiler-rejected.
- `object|codebase`: normal interpolation throws `NG0904`; direct `i18n-codebase` is compiler-rejected.

Residual cases do not currently show useful impact:

- `frame|src`: normal interpolation throws `NG0904`; direct `i18n-src` renders `<frame>` without a usable `src` value in the framework acceptance runtime.
- `base|href`: normal interpolation throws `NG0904`; direct `i18n-href` renders `<base>` without a usable `href` value in the framework acceptance runtime.
- `script` URL attrs: script element template shapes render no script element/body content.

## Root Cause Boundary

`i18nAttributesFirstPass()` still selects sanitization by attribute name:

- `packages/core/src/render3/i18n/i18n_parse.ts:385-392`

This is why A4 exists for `link|href`: the runtime cannot distinguish `a|href` from `link|href`.

However the compiler has an earlier guard for Trusted Types sinks:

- `packages/compiler/src/render3/view/i18n/meta.ts:201-215`
- `packages/compiler/src/schema/trusted_types_sinks.ts:16-31`

That guard blocks the strongest executable/embed sinks before the runtime i18n sanitizer selection is reached.

## Evidence

See:

- `poc/a15_i18n_resource_url_matrix.patch`
- `evidence/2026-04-29-bazel-resource-url-i18n-matrix.md`

## Reportability

Not reportable as a new VRP finding from this A15 expansion.

The reportable-ish residue remains A4 only, and A4 is still bounded: it demonstrates `link|href`
`RESOURCE_URL` policy bypass plus browser resource fetch, not script execution or a strong default-app
security impact.

## Next Escalation

Do not keep deepening this exact CVE class unless a browser-real app shows `base|href` or `frame|src`
becoming a useful navigation/fetch primitive. The current Phase 1 result for `GHSA-g93w-mfhg-p222`
should be treated as closed with:

- A4: confirmed bounded primitive.
- A15: high-impact sibling variants refuted.
