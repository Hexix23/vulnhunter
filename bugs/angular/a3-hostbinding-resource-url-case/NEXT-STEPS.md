# Next Steps

## Objective

Raise or refute exploitability beyond `SafeResourceUrl` policy downgrade.

## Browser Validation Targets

1. `base|href`
   - Build a normal Angular app with a generic `[attr.href]` host-binding directive.
   - Render `<BASE appHref>` with attacker-controlled URL.
   - After Angular updates the base URL, create or navigate through relative links/resources.
   - Impact question: can this redirect same-app relative navigations, form targets, preload URLs,
     or credential-bearing requests to attacker infrastructure?

2. `link|href`
   - Test `rel=stylesheet`, `preload`, `modulepreload`, `icon`, `manifest`.
   - Impact question: does attacker-controlled URL produce script execution, CSS-based data impact,
     credential exposure, or a meaningful policy bypass under modern Chromium?

3. `embed|src`
   - Test modern Chromium behavior for HTML, SVG, PDF, and plugin/content fallback.
   - Impact question: does remote content gain same-origin capability, script execution, or only
     isolated/opaque rendering?

4. Trusted Types / CSP
   - Enable production-style CSP and Trusted Types enforcement.
   - Impact question: does the downgrade bypass a browser-enforced TrustedScriptURL boundary, or is
     the effect limited to Angular's own `SafeResourceUrl` contract?

## Library Pattern Search

Prioritize real-world patterns that satisfy all preconditions:

- generic directive selector (`[foo]`, not `iframe[foo]`, `link[foo]`, or `a[foo]`)
- host binding to `[attr.src]`, `[attr.href]`, `@HostBinding('attr.src')`, or
  `@HostBinding('attr.href')`
- attacker-influenced input
- documented/recommended use on arbitrary host elements or ResourceURL elements

Patterns currently observed publicly are mostly `img[src]` lazy-load and `a[href]` external-link
directives, which do not by themselves create ResourceURL impact.

## Severity Gate

Keep severity at `Low-to-Medium` until one of these is true:

- browser validation shows origin-relevant script execution or data exfiltration;
- `base|href` creates meaningful navigation/resource integrity impact in a normal app;
- a widely used library exposes the exact generic ResourceURL sink pattern to attacker-controlled
  data;
- Trusted Types/CSP validation shows a browser-level policy bypass, not only Angular internal policy
  downgrade.
