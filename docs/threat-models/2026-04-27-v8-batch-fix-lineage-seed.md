# V8 Batch Fix Lineage Seed

**Date:** 2026-04-27
**Purpose:** Minimal Phase C seed for V8. This is intentionally short: enough to steer the next probes without turning the lineage into prompt bloat. It records what the two public batch releases signal before full patch-to-commit mapping.

## Batch A - 2025-10-28

**Public V8 CVEs in the release:**

- `CVE-2025-12036` - inappropriate implementation in V8
- `CVE-2025-12428` - type confusion in V8
- `CVE-2025-12429` - inappropriate implementation in V8
- `CVE-2025-12432` - race in V8
- `CVE-2025-12433` - inappropriate implementation in V8
- `CVE-2025-12441` - out-of-bounds read in V8
- `CVE-2025-13226` through `CVE-2025-13230` - five type confusions in V8

**Public fingerprint:**

- Mixed batch, not a monoculture.
- At least one **logic cluster** (`12036`, `12429`, `12433`).
- At least one **JIT / stale-assumption cluster** (`12428`, `13226`-`13230`).
- At least one **GC / concurrency / state** signal (`12432`).

**Operational takeaway:**

- Do not collapse this release into only "more JIT type confusion".
- Use it to justify keeping **Temporal / RegExp logic probes** and **GC x JIT probes** in the same priority band as Turboshaft reducers.

## Batch B - 2026-04-07

**Public V8 CVEs in the release:**

- `CVE-2026-5861` - use after free in V8
- `CVE-2026-5862` - inappropriate implementation in V8
- `CVE-2026-5863` - inappropriate implementation in V8
- `CVE-2026-5865` - type confusion in V8
- `CVE-2026-5871` - type confusion in V8
- `CVE-2026-5873` - out-of-bounds read and write in V8

**Public fingerprint:**

- Another mixed cluster across **logic + optimizer + memory-safety**.
- Confirms that 2026 V8 fixes are not converging onto one single class.
- Reinforces the need for split hunting across logic surfaces and JIT / heap surfaces.

## How to use this seed

- Treat **C13 / C16 / C17** as batch-driven follow-ons for the logic cluster.
- Treat **C3 / C11** as batch-driven follow-ons for the optimizer / GC cluster.
- When issue links de-restrict, replace this seed with a true patch-diff lineage doc keyed by commit and file.

## Deliberate omission

This seed does **not** include full patch notes, source excerpts, or long commit discussions. That material belongs in per-candidate slices once a concrete file:line target is chosen.
