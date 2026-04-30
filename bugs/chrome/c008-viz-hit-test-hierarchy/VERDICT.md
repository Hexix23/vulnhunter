# C008 Verdict

Status: IN PROGRESS

Confirmed:
- Stable release maps this class to CVE-2026-7360, high severity.
- Local source validates hierarchy only at aggregation time.
- Existing unit test `InvalidChildFrameSinkIdRejected` confirms invalid
  submitted regions remain stored after rejection.

Not yet confirmed:
- No bypass of the new direct-child validation.
- No cross-origin input hijack, UI integrity violation, or memory safety impact
  demonstrated from a fresh variant.

Priority gates:
1. H1 needs an added submit-index bump or unrelated fresh submission to be
   meaningful; hierarchy-only aggregation is blocked by the submit index cache.
2. H2 is probably self-DoS unless a browser-level embedding shape lets one
   untrusted child suppress another origin's valid child region.
3. Continue only if a bypass of `IsChildOf()` or cross-owner routing effect is
   found; otherwise pivot away.
