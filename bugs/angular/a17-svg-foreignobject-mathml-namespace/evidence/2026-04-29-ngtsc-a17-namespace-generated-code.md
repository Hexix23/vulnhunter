# Evidence: A17 Namespace Generated Code

Date: 2026-04-29

Command:

```bash
bazelisk --output_user_root=/tmp/vulnhunter-bazel-user test \
  //packages/compiler-cli/test/ngtsc:ngtsc \
  --test_output=errors \
  --test_filter='A17 probe'
```

The temporary test intentionally failed to dump `test.js`.

## Initial Negative Control

Including MathML `<annotation-xml [attr.href]="url">` without suppressing diagnostics failed before
DOM creation:

```text
NG8001: ':math:annotation-xml' is not a known element
```

This path is not a normal-template runtime sink in the tested compiler configuration.

## Generated Code For Mixed Namespace Probe

Relevant generated template:

```ts
if (rf & 1) {
  i0.ɵɵnamespaceSVG();
  i0.ɵɵdomElementStart(0, "svg")(1, "foreignObject");
  i0.ɵɵnamespaceHTML();
  i0.ɵɵdomElementStart(2, "a");
  i0.ɵɵtext(3, "link");
  i0.ɵɵdomElementEnd();
  i0.ɵɵdomElement(4, "iframe")(5, "iframe")(6, "div")(7, "form");
  i0.ɵɵdomElementEnd()();
  i0.ɵɵnamespaceMathML();
  i0.ɵɵdomElementStart(8, "math");
  i0.ɵɵdomElement(9, "semantics")(10, "maction");
  i0.ɵɵdomElementEnd();
}
if (rf & 2) {
  i0.ɵɵadvance(2);
  i0.ɵɵattribute("href", ctx.url, i0.ɵɵsanitizeUrl);
  i0.ɵɵadvance(2);
  i0.ɵɵattribute("srcdoc", ctx.html, i0.ɵɵsanitizeHtml);
  i0.ɵɵadvance();
  i0.ɵɵattribute("sandbox", ctx.policy, i0.ɵɵvalidateAttribute);
  i0.ɵɵadvance();
  i0.ɵɵattribute("style", ctx.style, i0.ɵɵsanitizeStyle);
  i0.ɵɵadvance();
  i0.ɵɵattribute("action", ctx.url, i0.ɵɵsanitizeUrl);
  i0.ɵɵadvance(2);
  i0.ɵɵattribute("href", ctx.url, i0.ɵɵsanitizeUrl)("href", ctx.url, i0.ɵɵsanitizeUrl, "xlink");
  i0.ɵɵadvance();
  i0.ɵɵattribute("actiontype", ctx.actiontype)("href", ctx.url, i0.ɵɵsanitizeUrl);
}
```

## Interpretation

`foreignObject` resets children to HTML namespace and the compiler preserves the expected security
contexts:

- HTML `a[href]` -> `ɵɵsanitizeUrl`
- HTML `iframe[srcdoc]` -> `ɵɵsanitizeHtml`
- HTML `iframe[sandbox]` -> `ɵɵvalidateAttribute`
- HTML `style` attr -> `ɵɵsanitizeStyle`
- HTML `form[action]` -> `ɵɵsanitizeUrl`

MathML tested sinks are also covered:

- `semantics[href]` / `semantics[xlink:href]` -> `ɵɵsanitizeUrl`
- `maction[href]` -> `ɵɵsanitizeUrl`

`maction[actiontype]` receives no sanitizer, but this is not a URL/script sink in the tested model.
