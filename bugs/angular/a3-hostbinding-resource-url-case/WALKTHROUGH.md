# Walkthrough

1. Started from A3/A4 invariants: DOM schema, runtime i18n, and URL/ResourceURL dispatch must stay aligned.
2. Refuted the first i18n `iframe[src]` hypothesis because the compiler blocks translating `iframe src`.
3. Noted a broader invariant mismatch: `isTrustedTypesSink()` lowercases inputs, `DomElementSchemaRegistry.securityContext()` lowercases inputs, but `getUrlSanitizer()` does not.
4. Added direct sanitizer assertions:
   - lowercase `iframe/src` throws `NG0904`.
   - uppercase `IFRAME/src` and `iframe/SRC` did not throw.
5. Followed the runtime path to host bindings:
   - ambiguous host `src` gets `ɵɵsanitizeUrlOrResourceUrl`.
   - `setElementAttribute()` passes `tNode.value` and the attribute name to the sanitizer.
6. Added host-binding controls:
   - lowercase `<iframe unsafeResourceUrlHostBindingDir>` throws.
   - uppercase `<IFRAME unsafeResourceUrlHostBindingDir>` does not throw and sets the plain string URL.
7. Added attribute-casing variant:
   - lowercase `<iframe>` plus directive host binding `[attr.SRC]` does not throw and sets the plain string URL.
8. Probed direct `script[src]` escalation:
   - uppercase `<SCRIPT>` did not render; Angular ignores script elements in render3 templates.
   - this currently blocks a direct script-execution severity jump.
9. Validated against Angular `dev-app`:
   - patched a real app component with `UnsafeFrameSrcDirective`.
   - `//dev-app:test` passed and observed `src="http://attacker.example/poc-frame.html"`.
   - `//dev-app:build` completed successfully.
10. Expanded a ResourceURL host-binding matrix:
   - affected: `iframe|src`, `embed|src`, `frame|src`, `base|href`, `link|href`.
   - protected: `object|data`, `object|codebase`.
   - not rendered: `script|src`, `script|href`, `script|xlink:href`.
11. Exploitability expansion:
   - SVG script escalation was probed and did not produce an effective script URL.
   - element-qualified `iframe[dir]` directive was protected for normal lowercase templates.
   - component host binding on `iframe[cmp]` was protected.

Next validation:

- Run the same PoC in a browser-backed web test when Chromium is available in the VM, and observe
  actual network navigation/request from the iframe.
- Probe browser behavior per affected sink, especially `base|href` and `link|href`, because their
  impact depends on document placement and browser-side processing.
