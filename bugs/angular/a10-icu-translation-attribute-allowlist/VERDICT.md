# A10 ICU Translation Attribute Allowlist

Status: `CONFIRMED-BOUNDED-PRIMITIVE / NOT-VRP-STRONG`

## Summary

`GHSA-prjf-86w9-mfqv` / `CVE-2026-27970` fixed XSS in translated ICU HTML by blocking static
URI-bearing ICU attributes and dropping unknown attributes. The fix is class-wide for the original
dangerous sinks such as `href`, `src`, `data`, `codebase`, `action`, and `formaction`.

One residual allowed attribute exists: `srcset`. It is present in `VALID_ATTRS`, but not in
`SENSITIVE_ATTRS`, so a translator-controlled ICU case can still create:

```html
<img srcset="https://attacker.test/pixel.png 1x">
```

The Angular render3 i18n parser preserves that attribute and writes it to DOM.

## Prior Advisory

Source: `https://github.com/angular/angular/security/advisories/GHSA-prjf-86w9-mfqv`

The advisory describes XSS in Angular i18n ICU translated content. Its attacker model is a malicious
or compromised translation file, and the vulnerable app must use Angular i18n plus ICU messages.

## Fix Lineage

Fix PR: `https://github.com/angular/angular/pull/67183`

Local fix commit:

```text
747548721d051c21e388a302d20d53fb3ab16367
```

The key fix changed `packages/core/src/render3/i18n/i18n_parse.ts` around `walkIcuTree()`.

Before the fix, non-bound attributes inside ICU HTML were trusted:

```ts
// we assume the input string is safe, unless it's using a binding
...
} else {
  addCreateAttribute(create, newIndex, attr);
}
```

After the fix, ICU attributes are allowlisted and URI-sensitive static attributes are blocked:

```ts
} else if (VALID_ATTRS[lowerAttrName]) {
  if (SENSITIVE_ATTRS[lowerAttrName]) {
    addCreateAttribute(create, newIndex, attr.name, 'unsafe:blocked');
  } else {
    addCreateAttribute(create, newIndex, attr.name, attr.value);
  }
}
```

Relevant current code:

- `packages/core/src/render3/i18n/i18n_parse.ts:800-843`
- `packages/core/src/sanitization/html_sanitizer.ts:78-127`

## Probe

Patch used for the focused parser probe:

```text
bugs/angular/a10-icu-translation-attribute-allowlist/poc/a10_render3_srcset_probe.patch
```

The probe adds this Angular render3 i18n parser spec:

```ts
it('A10 probe: preserves static srcset introduced by ICU translation', () => {
  const tI18n = toT18n(`{
    �0�, select,
      A {<img srcset="https://attacker.test/pixel.png 1x">}
      other {safe}
  }`);

  fixture.apply(() => {
    applyCreateOpCodes(fixture.lView, tI18n.create, fixture.host, null);
  });

  fixture.apply(() => {
    ɵɵi18nExp('A');
    ɵɵi18nApply(0);
    expect(fixture.host.innerHTML).toEqual(
      `<img srcset="https://attacker.test/pixel.png 1x"><!--ICU ${HEADER_OFFSET + 0}:0-->`,
    );
  });
});
```

Command:

```bash
bazelisk --output_user_root=/tmp/vulnhunter-bazel-user test //packages/core/test/render3:render3 --test_filter='A10 probe'
```

Evidence:

```text
bugs/angular/a10-icu-translation-attribute-allowlist/evidence/2026-04-29-render3-a10-srcset-test.log
```

Result:

```text
507 specs, 0 failures, 2 pending specs
```

## Impact Assessment

Confirmed:

- A malicious translation can introduce static `img[srcset]` through ICU HTML.
- Angular preserves the `srcset` attribute because `srcset` is in `VALID_ATTRS`.

Not confirmed:

- No XSS.
- No script execution.
- No credential leak.
- No cross-user impact.
- No bypass of the fixed `href`, `src`, `action`, `formaction`, `data`, or `codebase` cases.

The `srcset` behavior is also consistent with Angular's HTML sanitizer tests:

```text
packages/core/test/sanitization/html_sanitizer_spec.ts:76
```

That test states that modern browsers can handle `srcset` safely without extra sanitization and
expects `javascript:` inside `srcset` to remain in sanitized HTML. This makes the residual weaker
than a new sanitizer bypass: Angular already treats `srcset` as a permitted browser-managed image
selection attribute.

## Verdict

`CONFIRMED-BOUNDED-PRIMITIVE`, not a report candidate by itself.

The original ICU XSS class appears closed for the tested static URI sinks. The only residual found
in this pass is `srcset` preservation, which can at most cause image/resource fetch behavior in the
tested model. Without script execution, credential leakage, or a stronger browser side effect, this
does not meet the reportability bar.

## Next Step

Close `GHSA-prjf-86w9-mfqv` for Phase 1 unless a new ICU sink outside `VALID_ATTRS` appears.

Move to the next CVE-derived surface:

```text
GHSA-v4hv-rgfq-gp49 - DOM schema SVG/MathML URL attributes and animation indirection
```
