# A11 - GHSA-v4hv-rgfq-gp49 DOM schema SVG/MathML/animation residuals

IMPACT_CLASS: SECURITY_LOGIC

VERDICT: CONFIRMED_GAP_NOT_EXPLOITABLE

One-line reason: Current Angular compiler output still leaves several SVG URL-like attribute bindings without sanitizer/validator, but Chrome 147 validation did not turn the tested residuals into script execution, `javascript:` execution, or `animate[by]` href mutation.

## Tested invariant

Every browser-executable URL/resource sink, including SVG/MathML namespace aliases and SVG animation attribute indirection, should be assigned a sanitizer or runtime `validateAttribute` guard.

## Source review

- `packages/compiler/src/schema/dom_security_schema.ts:32-126` registers MathML URL attrs and SVG `script|href/xlink:href`, but does not register SVG `use|href`, `image|href`, or `mpath|href`.
- `packages/compiler/src/schema/dom_security_schema.ts:136-164` blocks SVG animation `attributeName`, `to`, `from`, and `values`, but not `by`.
- `packages/core/src/sanitization/sanitization.ts:306-314` mirrors that runtime guard set: `animate` guards `attributeName/to/values/from`; `set` guards `attributeName/to`; `animateMotion` and `animateTransform` only guard `attributeName`.
- `packages/compiler-cli/test/compliance/test_cases/r3_compiler_compliance/elements/namespace_attr.js:7` already shows `<svg:use [attr.xlink:href]>` compiling to `ɵɵattribute("href", ctx.value, null, "xlink")`.

## Probe results

### Compiler probe

Temporary `ngtsc` test compiled:

```html
<svg>
  <use [attr.xlink:href]="url"></use>
  <use [attr.href]="url"></use>
  <image [attr.xlink:href]="url" [attr.href]="url"></image>
  <mpath [attr.xlink:href]="url" [attr.href]="url"></mpath>
  <animate attributeName="href" [attr.by]="url"></animate>
</svg>
<math><mi [attr.href]="url" [attr.xlink:href]="url"></mi></math>
```

Observed generated-code fragments:

- `ɵɵattribute("href", ctx.url, null, "xlink");`
- `ɵɵattribute("href", ctx.url);`
- `ɵɵattribute("by", ctx.url);`
- MathML control is covered: `ɵɵattribute("href", ctx.url, ɵɵsanitizeUrl)("href", ctx.url, ɵɵsanitizeUrl, "xlink");`

Command:

```bash
bazelisk --output_user_root=/tmp/vulnhunter-bazel-user test //packages/compiler-cli/test/ngtsc:ngtsc --test_filter='A11 probe'
```

Result: passed after converting the probe to fragment-level oracles. See:

- `poc/a11_ngtsc_svg_mathml_probe.patch`
- `evidence/2026-04-29-ngtsc-a11-generated-code-pass-shard2.log`
- `evidence/2026-04-29-ngtsc-a11-generated-code-failing-oracle.log`

### Browser impact probe

Chrome 147 headless loaded raw SVG equivalents for:

- `<use href="http://127.0.0.1/.../external.svg#shape">`
- `<use xlink:href="http://127.0.0.1/.../external.svg#shape">`
- `<image href="http://127.0.0.1/.../image.svg">`
- `<mpath href="http://127.0.0.1/.../mpath.svg#motion">`
- `<use href="javascript:top.postMessage(...)">`
- `<image href="javascript:top.postMessage(...)">`
- `<animate attributeName="href" by="http://127.0.0.1/.../external.svg#shape">`

Observed:

- `/external.svg` and `/image.svg` were fetched as image-like resources.
- The SVG external `<script>` did not execute (`messages=`).
- `javascript:` payloads in `use`/`image` did not execute.
- `animate[by]` did not mutate the target href (`finalByHref=#local`).
- `mpath` did not produce a distinct fetch in this probe.

Evidence:

- `poc/browser_svg_sink_probe.mjs`
- `evidence/2026-04-29-browser-svg-sink-impact.json`

## Reportability

Not VRP-strong as tested.

The compiler gap is real and should be catalogued as a hardening primitive: some SVG URL-ish sinks bypass Angular sanitization. However, for the tested residuals, modern Chrome treats the dangerous parts as inert:

- no XSS,
- no script execution from external SVG,
- no `javascript:` execution,
- no demonstrated credential or cross-user data exposure,
- no demonstrated content integrity impact beyond ordinary image/resource loading.

This CVE should be marked closed for Phase 1 unless a later chain needs browser-controlled SVG resource fetching as a primitive.
