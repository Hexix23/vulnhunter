---
name: google-vrp-reporting
description: Use when drafting or reviewing Google VRP vulnerability reports, Bug Hunter submissions, security impact writeups, PoCs, or reports based on GOOGLE_VRP templates.
---

# Google VRP Reporting

## Overview

Write Google VRP reports as evidence-first security findings. The report must make it easy for a triager to answer: what is the bug, why is it owned by the product, how do I reproduce it, and what concrete security impact was demonstrated.

## Default Behavior

When the user asks for a Google VRP report, write the report. Do not stop at template discovery,
template mismatch commentary, or a proposal unless the user explicitly asks only for planning or
review.

## Source Template

Use the repository template when present:

```text
templates/GOOGLE_VRP_TEMPLATE.md
templates/GOOGLE_VRP_QUICK_SUBMIT_TEMPLATE.md
```

If no exact template name requested by the user exists, use the closest available Google VRP
template or the report shape below. Mention filename mismatches only briefly in the final status,
not as a blocker and not as the main output.

## Report Shape

Use this order unless the repository template requires otherwise:

1. Title: product, component, bug class, root cause.
2. Metadata: product, repository, component, version/commit, bug type/CWE, severity only if requested or required.
3. Vulnerability Description: technical root cause with file:line references.
4. Impact: only demonstrated or directly implied impact; avoid speculative severity inflation.
5. Steps to Reproduce: exact commands from a clean checkout/worktree.
6. Observed Result: HTML/logs/crash/output proving the bug.
7. Expected Result: what the framework/security invariant should have done.
8. Product Ownership: separate product-controlled behavior from app/deployment preconditions.
9. Scope and Limitations: state caveats that do not invalidate the finding.
10. Suggested Fix: actionable product-side fixes.
11. References: advisories, docs, source paths, evidence files.

## Google VRP Style Rules

- Lead with the strongest single vulnerability. Do not submit three loosely related bugs as one report.
- Do not call a finding SSRF, request smuggling, XSS, or auth bypass unless the PoC proves that class directly.
- Frame impact as concrete outcomes: protected route rendered, private state serialized, wrong tenant response replayed, backend endpoint not called.
- Distinguish framework behavior from application/deployment conditions.
- Avoid asking the triager to infer impact from code alone; include runtime output.
- Include exact versions, ports, commands, and file paths.
- If a chain depends on deployment behavior, keep it as an impact amplifier, not the base claim.
- Keep mitigations honest: mention documented opt-outs if they exist, but explain why the default remains unsafe.

## Angular SSR TransferCache Notes

For Angular SSR transfer-cache bugs, report as a cache semantics / trusted-response replay issue unless another class is directly proven.

Good framing:

```text
Angular SSR HttpTransferCache replays an attacker-controlled response as a trusted /api/me response during SSR because the default transfer-cache key omits security-relevant request variants and is reduced to a collision-prone 32-bit StateKey.
```

Avoid overclaiming:

```text
HTTP request smuggling
Critical auth bypass
Universal cross-user leak
```

Use `CanActivate`/resolver/server-rendered protected content as the strongest native Angular impact when available. Treat CDN/shared HTML cache leakage as conditional unless reproduced against a real target deployment.
