# Next Steps

## Remaining impact validation

Browser validation confirmed remote fetch for dynamic `rel=stylesheet`, static `rel=preload`, and
static `rel=modulepreload`. It did not confirm script execution.

Next impact questions:

- Can attacker CSS create a meaningful UI integrity or data exposure primitive in a realistic app?
- Can `preload` / `modulepreload` be chained into cache/preload poisoning or other origin-relevant
  side effects?
- Does CSP or Trusted Types change the result?
- Does a document-head projection shape cause `manifest` or `icon` fetch where body-level component
  links did not?

## Fix hypothesis

`i18nAttributesFirstPass()` needs tag-aware sanitizer selection, or the compiler should reject
direct i18n of translated attributes whose full `tag|attr` security context is `RESOURCE_URL`, not
only Trusted Types sinks.
