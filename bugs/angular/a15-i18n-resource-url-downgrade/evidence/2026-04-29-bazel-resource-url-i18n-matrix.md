# Evidence: A15 i18n ResourceURL Matrix

Date: 2026-04-29

Command:

```bash
bazelisk --output_user_root=/tmp/vulnhunter-bazel-user test \
  //packages/core/test/acceptance:acceptance \
  --test_output=errors \
  --test_filter='security research probe: resource URL i18n direct matrix'
```

The temporary test intentionally failed to dump the probe matrix.

## Result Matrix

```json
[
  {
    "name": "iframe-baseline-interpolation",
    "template": "<iframe src=\"{{httpUrl}}\"></iframe>",
    "outcome": "throw",
    "error": "NG0904: unsafe value used in a resource URL context ..."
  },
  {
    "name": "iframe-i18n-interpolation",
    "template": "<iframe src=\"{{httpUrl}}\" i18n-src></iframe>",
    "outcome": "throw",
    "error": "Translating attribute 'src' is disallowed for security reasons."
  },
  {
    "name": "iframe-i18n-javascript-control",
    "template": "<iframe src=\"{{jsUrl}}\" i18n-src></iframe>",
    "outcome": "throw",
    "error": "Translating attribute 'src' is disallowed for security reasons."
  },
  {
    "name": "object-baseline-interpolation",
    "template": "<object data=\"{{httpUrl}}\"></object>",
    "outcome": "throw",
    "error": "NG0904: unsafe value used in a resource URL context ..."
  },
  {
    "name": "object-i18n-interpolation",
    "template": "<object data=\"{{httpUrl}}\" i18n-data></object>",
    "outcome": "throw",
    "error": "Translating attribute 'data' is disallowed for security reasons."
  },
  {
    "name": "object-codebase-baseline-interpolation",
    "template": "<object codebase=\"{{httpUrl}}\"></object>",
    "outcome": "throw",
    "error": "NG0904: unsafe value used in a resource URL context ..."
  },
  {
    "name": "object-codebase-i18n-interpolation",
    "template": "<object codebase=\"{{httpUrl}}\" i18n-codebase></object>",
    "outcome": "throw",
    "error": "Translating attribute 'codebase' is disallowed for security reasons."
  },
  {
    "name": "embed-baseline-interpolation",
    "template": "<embed src=\"{{httpUrl}}\">",
    "outcome": "throw",
    "error": "NG0904: unsafe value used in a resource URL context ..."
  },
  {
    "name": "embed-i18n-interpolation",
    "template": "<embed src=\"{{httpUrl}}\" i18n-src>",
    "outcome": "throw",
    "error": "Translating attribute 'src' is disallowed for security reasons."
  },
  {
    "name": "frame-baseline-interpolation",
    "template": "<frame src=\"{{httpUrl}}\">",
    "outcome": "throw",
    "error": "NG0904: unsafe value used in a resource URL context ..."
  },
  {
    "name": "frame-i18n-interpolation",
    "template": "<frame src=\"{{httpUrl}}\" i18n-src>",
    "outcome": "rendered",
    "value": null,
    "html": "<frame>"
  },
  {
    "name": "base-baseline-interpolation",
    "template": "<base href=\"{{httpUrl}}\">",
    "outcome": "throw",
    "error": "NG0904: unsafe value used in a resource URL context ..."
  },
  {
    "name": "base-i18n-interpolation",
    "template": "<base href=\"{{httpUrl}}\" i18n-href>",
    "outcome": "rendered",
    "value": null,
    "html": "<base>"
  },
  {
    "name": "script-i18n-interpolation",
    "template": "<script src=\"{{httpUrl}}\" i18n-src></script>",
    "outcome": "rendered",
    "value": null,
    "html": ""
  },
  {
    "name": "script-href-i18n-interpolation",
    "template": "<script href=\"{{httpUrl}}\" i18n-href></script>",
    "outcome": "rendered",
    "value": null,
    "html": ""
  }
]
```

## Source Guards

- `packages/compiler/src/render3/view/i18n/meta.ts:201-215` rejects `i18n-*` attributes whose `tag|attr` is a Trusted Types sink.
- `packages/compiler/src/schema/trusted_types_sinks.ts:16-31` includes `embed|src`, `iframe|src`, `object|codebase`, and `object|data`.
- `packages/compiler/src/schema/dom_security_schema.ts:113-126` has broader `RESOURCE_URL` coverage including `base|href`, `frame|src`, `link|href`, and script URL attrs.

## Interpretation

The high-impact resource tags from this CVE family close on compiler rejection:

- `iframe|src`
- `embed|src`
- `object|data`
- `object|codebase`

Residual schema mismatches:

- `link|href` remains the A4 confirmed bounded primitive.
- `frame|src` and `base|href` pass the compiler but the tested runtime emits no usable attribute value.
- `script` elements are stripped/inert in the tested template shape.

No XSS, navigation, or browser fetch was confirmed in this A15 matrix.
