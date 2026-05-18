---
name: threat-model-vrp
description: End-to-end methodology for bug-bounty-grade (VRP) vulnerability research. Project-agnostic phases (recon → minimal threat model → thin-slice source audit → runtime PoC → verification → conservative scoring → bounty-ready report) with per-program adaptations (Google VRP, Vercel OSS HackerOne, Angular Security, GitHub OSS). Use when starting a new VRP target, returning to a paused target, or moving a confirmed primitive into a reportable submission. Triggers - "threat model X", "find bugs in X for bounty", "verify Y bug end-to-end for VRP", "submit report for VRP", "research attack surface for X".
---

# Threat-Model-VRP — Vulnerability Research Methodology

A repeatable pipeline that turns a target project into one or more bounty-grade reports. Same methodology, per-program adaptation, no scaffolding bloat.

Inspired by Devansh's "needle in the haystack" methodology and refined from framework, parser, cache, compiler, and server-runtime vulnerability research.

## Core principles

1. **Threat model FIRST, not last.** Read CVE history before reading source code.
2. **Thin slices, not whole codebases.** Audit ≤100 lines at a time with full context for that slice.
3. **Adversarial framing always.** "This slice IS vulnerable, prove or refute." Never "is this safe?"
4. **Runtime proof or it didn't happen.** Source review alone is a lead, not a finding. PoC against a real local build is the bar.
5. **Conservative claims.** Never overclaim. Map exactly what was demonstrated to CVSS metrics. Separate "primitive" from "chain" from "amplifier."
6. **Avoid context rot.** Do not load historical scaffolding from unrelated targets when working a slice. One target context per session.
7. **Program rules trump methodology.** Each program has explicit constraints on scope, severity, payout, and disclosure. Read them before reporting.
8. **Structural invariants beat sink lists.** Prefer "which existing security invariant does this alternate pipeline bypass?" over "which isolated sink looks dangerous?"
9. **Basic primitives before complex chains.** Before cache poisoning, codegen pivots, RCE chains, or multi-step gadgets, test the boring boundary primitives: absolute URLs, duplicate headers, path forms, encoding, ports, redirects, parser differentials, and missing validators in lower-level APIs. Many CVEs are simple authority or trust-boundary mistakes.

## Phases

### Phase 0 — Program selection + rules

For each candidate target, identify the bounty program and capture rules.

Output: `docs/program/<program>.md`

Required fields:
- Program name + canonical URL
- Scope (Tier 1/2/3 lists, target classes)
- Severity model (CVSS 3.1, 4.0, or custom)
- Bonus modifiers
- CVE eligibility threshold
- Exclusions (universal + project-specific)
- Rules of engagement (no prod testing, rate limits, no destructive testing)
- Submission requirements (zip PoC, 1 vuln per report, root-cause consolidation)
- Disclosure / confidentiality (lockout period, public release policy)
- SLA targets (first response, triage, payout)
- Contact channels (HackerOne, security@, PGP keys)

Common programs and quirks:

| Program | Scope quirks | Severity model | Bonus modifiers | Notes |
|---|---|---|---|---|
| **Vercel OSS HackerOne** | Tier 1: Next.js, Nuxt, SvelteKit, Svelte, SWR, AI SDK, Turborepo, Vercel CLI, workflow, flags, ms, Nitro.js, Async-Sema, Skills; Tier 2: other vercel/vercel-labs/nuxt/sveltejs repos; Tier 3 (since March 2026): non-standard config / experimental | CVSS 4.0 with Vercel adjustments | +50% multi-project, +25% with patch suggestion, +25% core security feature | Zip PoC mandatory. 1 vuln per report (chain allowed if needed for impact). No production testing on vercel.com / customer sites / CI/CD. CVE: Tier-1 adjusted ≥3.8; Tier-2 adjusted ≥7.0. CVE published +30 days after assignment. 2-year confidentiality. |
| **Google VRP (OSS)** | Angular, Protobuf, V8, Chrome, etc. as separate programs | CVSS 3.1 typically | Class-based payout matrix | Reports via security@<project>.io with PGP for some. Integrity/confidentiality matters; DoS-only typically rejected. |
| **Google VRP (Chrome)** | Chrome process boundaries | Severity rubric (Critical/High/Medium/Low) | Reduced if sandboxed renderer only | Reports via bughunters.google.com. Requires ASan/MSan repro for memory issues. |
| **Angular Security** | angular/angular | CVSS 3.1, advisory-style | No formal bonus, GHSA emission | security@angular.io, PGP required. Coordinated disclosure. No public PR/issue. |
| **GitHub OSS (project-managed)** | Per-repo Security Advisories | Maintainer discretion | Per-repo | Use private vulnerability reporting on the repo. |

### Phase 1 — Target pinning

Lock the exact code under test.

Capture in `docs/threat-models/<date>-<target>-minimal-threat-model.md`:
- Repo + commit hash + branch + commit date
- Versions to be tested (latest stable + canary if program prefers)
- Build mode (production-only typical: `next build && next start`, not `next dev`)
- Local clone path + isolation (worktree, .gitignore for targets/, no committing target into research repo)
- Required runtime (Node version, Linux for native libs, VM if needed)

### Phase 2 — Prior art recon

Build the fix-lineage seed. Read CVE history *before* the source.

Output: `docs/threat-models/<date>-<target>-security-advisory-recon.md`

Sources to scan:
- GHSA Advisories on the target repo (`https://github.com/<owner>/<repo>/security/advisories`)
- NVD entries for the package name
- Vendor security blog / changelog
- HackerOne disclosed reports against the program (if visible)
- Recent merged PRs labeled `security`, `fix`, or with CVE refs
- Recent open PRs that look like silent security fixes (any `fix(...)` with no clear functional issue)

For each prior advisory, record:
- CVE / GHSA ID
- Affected versions + fix version
- Sink class (SSRF, RCE, XSS, cache poisoning, etc.)
- Root cause file:line
- Patch shape
- Whether the patch covers the entire class or only one manifestation

The latter is the most valuable: patches that fix one specific manifestation often leave the broader class accessible. Devansh's "fix-lineage seed."

### Phase 3 — Minimal threat model (≤1 page)

Output: `docs/threat-models/<date>-<target>-minimal-threat-model.md`

Required sections:
- Target pin
- Attacker model — what attacker controls, what they do not
- Trust boundaries — 3–5 named transitions (e.g. browser → server, middleware → render worker, user → server-action handler)
- High-value sink families — match the program's stated focus areas
- Reportability bar — quote the program's explicit threshold + your team's stricter threshold
- Out-of-scope shapes — what we will not chase (e.g. dev-only, app misuse, requires custom handler)

This document is the gravity well for the rest of the engagement. Anything that does not map back to a boundary or sink family on this page should not be on the to-do list.

### Phase 3.5 — Structural invariant extraction

Before expanding a sink list, identify the target's own security invariants and the alternate paths that might bypass them.

Output: add an "Invariants" section to the minimal threat model.

For each invariant, capture:

| Field | Meaning |
|---|---|
| Security model | The project-owned model that is supposed to enforce safety: schema, sanitizer, validator, allowlist, signature check, capability map, cache key, policy engine, authz layer |
| Primary enforcement path | The normal code path where the invariant is enforced |
| Alternate path | A second pipeline that handles equivalent input: localization, hydration, cache replay, redirect follow, prefetch, build output, deserializer, proxy, adapter, plugin, fallback |
| Expected consistency | The alternate path must enforce the same security decision as the primary path |
| Break candidate | Concrete file:line where the alternate path uses a weaker model, string parser, partial allowlist, or stale key |

Useful invariant prompts:

- "This validator exists. Which equivalent inputs reach the sink without it?"
- "This sanitizer exists. Which compile-time, cache, or replay path emits the same sink as trusted?"
- "This allowlist exists. Which redirect, proxy, resolver, or fallback path bypasses re-validation?"
- "This parser exists twice. Which one accepts a shape the other rejects?"
- "This security context is known in one package. Which package copied or approximated it?"
- "This wrapper validates input. Does the lower-level public API enforce the same invariant?"

### Phase 3.6 — Basic primitive pass (mandatory)

Run this before deep chains. For every trust boundary, enumerate the simplest attacker-controlled forms and ask whether the framework validates the exact representation later consumed by the sink.

Minimum matrix:
- absolute-form URLs, origin-form URLs, protocol-relative URLs, backslash variants;
- `Host`, duplicate `Host`, comma-joined headers, `Forwarded`, `X-Forwarded-*`;
- default ports, explicit non-default ports, IPv6 brackets, IPv4-mapped IPv6, IDNA/punycode;
- encoded path separators, encoded dot segments, mixed slashes, normalization before/after validation;
- redirects and retry/fallback paths that rebuild requests;
- lower-level exported APIs that bypass validation performed by higher-level wrappers;
- serializer/parser pairs for cache keys, hydration state, manifests, and request bodies.

For each primitive answer:
1. Which raw string enters the boundary?
2. Which normalized string is validated?
3. Which string/URL/object is consumed by the sink?
4. Are validation and sink using the same parser and authority representation?
5. Is there a current patched version where the primitive still bypasses the fix?

Only move to complex chains after this table is filled or explicitly marked N/A. This prevents anchoring on sophisticated exploit shapes while missing direct CVE-class bugs.

Classify every candidate before building a PoC:

| Classification | Use when |
|---|---|
| Sink manifestation | One concrete affected sink or endpoint |
| Structural root cause | The shared invariant violation explaining multiple manifestations |
| Chain | A second primitive needed to deliver or amplify the bug |
| Amplifier | Cache persistence, cross-user replay, multi-project reach, or higher-value target class |
| Hardening only | Real inconsistency but no practical attacker-controlled path |

Promote multiple sink manifestations into one stronger report only when they share the same structural root cause. Keep unrelated root causes as separate reports.

### Phase 4 — Sink matrix

Output: `docs/threat-models/<date>-<target>-sink-matrix.md` (or `-invariants-and-hunt-matrix.md`)

For each candidate sink family from Phase 3, list concrete sinks as a matrix row:

| Field | Example |
|---|---|
| ID | `N31` |
| Sink file:line | `image-optimizer.ts:863-895` |
| Function | `fetchExternalImage` |
| Attacker-controlled inputs | `url`, `accept` header |
| Trust boundary crossed | external attacker → server-side fetch |
| Security invariant | Private IPs must not be reachable through allowed remote image URLs |
| Primary enforcement path | `lookup()` + `isPrivateIp()` guard |
| Alternate path | independent `fetch()` DNS resolution or redirect recursion |
| Expected invariant | URL allowed by `remotePatterns` must not reach private IPs when `dangerouslyAllowLocalIP=false` |
| Classification | sink manifestation / structural root cause / chain / amplifier / hardening only |
| Plausible bug class | TOCTOU DNS rebinding, redirect-not-revalidated, content-type sniffing, cache poisoning |
| Minimal verification plan | DNS rebind server + private target + 1 curl |
| Reportability bet | Medium (5.4) base; High (7.4) with internal image/* target chain |

Reject rows that:
- Require non-default config beyond what the program already lists in Tier 3
- Only impact `next dev` / `--debug` (program-specific)
- Are exact repeats of a prior advisory unless the prior patch is bypassed on current canary

Before closing the matrix, run LLM leverage Passes 1-3 from `docs/methodology/llm-leverage-passes.md`:
- Pass 1 — patch-diff variant farm against recent advisories.
- Pass 2 — parser / serializer differential for the target's URL / header / pathname parsers.
- Pass 3 — symmetry / dual hunt for every validator that lacks an output dual.

Each pass should produce new matrix rows. If a pass returns nothing, document why before moving on. Matrix is closed only when techniques 1-9 of `threat-model-expansion.md` are at least partly applied.

### Phase 5 — Slice audit (adversarial, parallel)

Per high-priority sink, generate 3-5 thin slices and run them in parallel via `codex-rescue` (8 concurrent maximum). Full prompt template P4 lives in `llm-leverage-passes.md`.

Per-slice workflow:
1. Pin the slice to ≤100 LOC, file:line range exact.
2. One paragraph of contract context — what the function promises.
3. One paragraph of attacker model — what attacker controls upstream.
4. Adversarial prompt P4 from `llm-leverage-passes.md` (do not paraphrase, the wording matters).
5. Output: 3 enumerated invariant violations with (input, path, observable, falsifier).

Before promoting a candidate to Phase 6, apply Pass 5 (blind dual verification): a second session with defensive framing must fail to defend the slice. If both sessions disagree, the candidate stays in Phase 5 until evidence resolves the conflict.

Anti-patterns:
- Reading the whole file. Read the slice plus immediate dependencies only.
- Trusting "model says vulnerable" without runtime PoC in Phase 6.
- Running >8 slices concurrent. Rate limits saturate without yield gain.
- Sharing one prompt across slices for "efficiency". Context bleed creates convergent FPs.
- Skipping Pass 5 because "the first session was confident". Confidence is not evidence.

### Phase 5.3 — Prior-art duplicate check (mandatory, broader than GHSA)

Published GHSAs alone are not sufficient. Real-world: candidates can be
marked duplicate by triage even with no matching GHSA — vendor's
internal queue, recent unsubmitted reports, silently-merged fixes,
closed issues without security label all qualify as "known".

Before submission check ALL of: GHSAs, HackerOne hacktivity, GitHub
issues + closed security PRs (last 6 months), vendor blog posts,
public talks/blogs mentioning the function/file.

If any hit plausibly covers the candidate → either show clear novelty
angle OR park as known-class hardening. Full doctrine:
`docs/methodology/vulnhunt-methodology.md` F.0.4.

### Phase 5.4 — Documentation-disclosure gate (mandatory, before PoC build)

Read the official docs section for the affected sink/feature end-to-
end. Many frameworks ship a "Notes" or "Caveats" paragraph at the
config-reference page that discloses unsafe behavior and provides a
mitigation knob.

Test: "Does the framework docs explicitly disclose this behavior AND
provide a config knob to disable / restrict it?"

If yes → vendor will say "working as documented" in triage. Park as
hardening request. Do not submit as vulnerability. See
`docs/methodology/vulnhunt-methodology.md` F.0.3 for upgrade paths.

This is DISTINCT from Phase 5.5 — a behavior can be framework-native
(passes 5.5) yet documented as intentional (fails 5.4).

### Phase 5.5 — Native-vs-consumer gate (mandatory before PoC build)

Before opening any PoC, verify the exploit reaches the framework sink
without requiring the consumer app to deviate from the documented
canonical pattern.

Test: "Would the official `Getting Started` / first-page-of-docs
example exhibit this exploit if pasted unmodified?"

If no → consumer bug. Park as hardening request, do NOT submit. Three
escape hatches (framework-internal caller / documented-gate bypass /
sibling sink without consumer gate) — see
`docs/methodology/vulnhunt-methodology.md` F.0.2.

Triagers at Vercel OSS, Google VRP, Angular Security all apply this
gate first. Applying it yourself saves a rejected submission and the
credibility loss that follows.

### Phase 6 — Runtime PoC build

Build the smallest possible reproduction that proves or refutes the lead.

Rules:
- Production mode build matching the program's "covered" runtime (e.g. `next build && next start`, NOT `next dev`).
- Default config unless the candidate explicitly requires a config variant (and even then, only variants the program does not put in Tier 3).
- No `bypassSecurityTrust*`, no custom server, no monkey-patching framework internals.
- No production testing of real Vercel / customer / third-party endpoints.
- Isolated VM / container (e.g. orb ubuntu) for filesystem and network resets.

Components:
- Minimal app with only the surface needed for the lead.
- Attacker mock (DNS server, fake CDN, malicious upstream, etc.) bound to localhost.
- Runner script (shell or Node) that performs the precise request sequence.
- All artifacts under one directory ready to zip.

### Phase 7 — Verification matrix

Every candidate must pass all of these gates before being treated as a finding:

| Gate | Method |
|---|---|
| Positive — primitive triggers | Single canonical request reproduces the bug |
| Negative control 1 — guard works | Without the trigger, guard rejects |
| Negative control 2 — bypass refutation | Alternative inputs that should be blocked are blocked |
| Cross-version — latest stable | Reproduces on the program's latest stable |
| Cross-version — canary | Reproduces on canary (if program requires) |
| Cross-runtime | Webpack/Turbopack/Edge/standalone if applicable |
| Cache/persistence | If cache exists, test invariance across reload/restart |
| Content-type / body validation | Test what upstream bodies the framework accepts |
| Redirect re-validation | Does framework re-check guards on redirect target? |
| URL parser tricks | Userinfo, pct-encoding, IDN, case, trailing dot, alternate IP forms — does any bypass the pre-fetch gate? |

Record every gate outcome in evidence file. JSON + raw curl outputs.

### Phase 8 — Escalation research

After the base primitive is proven, look for chains that legitimately raise severity. Stay honest.

For each candidate escalation:
1. Identify the chain (e.g. primitive + cache → persistence; primitive + redirect-not-revalidated → wider attack surface).
2. Run a separate runtime test to prove the chain end-to-end.
3. Document what the chain proves vs assumes.
4. Update CVSS only when the chain is fully verified.

Adjacent escalation patterns to consider routinely:
- Cache poisoning persistence (cross-user replay window)
- Redirect target not re-validated
- Content-type / content sniffing
- Cookie/auth header forwarding through framework fetch
- Cross-project (same root cause in sibling frameworks → multi-project bonus)
- Trust boundary chain (middleware → render worker → image optimizer)

Stop rules:
- If a primitive needs a delivery channel and no native delivery is proven after two focused passes, mark it `confirmed primitive / delivery unsolved` and stop calling it High.
- If an exploit requires consumer app misuse, mark it `consumer bug / hardening` unless a documented framework path creates the same shape.
- If it requires dev mode, test-only env vars, private env vars, or non-production flags, mark it `non-production` unless the program explicitly includes that surface.
- If a candidate repeats a prior advisory and current stable/canary are patched, mark it `duplicate lineage / killed`.
- If two passes add no new path, close the sink with a verdict before opening another sink.

### Phase 9 — Cross-project pattern check (per program bonus)

If the program offers a multi-project bonus (Vercel OSS does +50%), spend ~30 min on each sibling project to see if the same root cause exists.

For Vercel OSS Tier 1, common siblings to check:
- Next.js ↔ Nuxt's `@nuxt/image` (image optimizer pattern)
- Next.js ↔ SvelteKit `enhanced-img` / `sharp`-based image handler
- Next.js Server Actions ↔ Nuxt nitro server handlers
- Next.js `proxy.js` / middleware ↔ Nuxt `defineEventHandler` middleware
- SWR caching ↔ Next.js Transfer Cache ↔ Nuxt useFetch caching
- Turborepo build cache ↔ Next.js build cache
- AI SDK tool/MCP execution boundary ↔ similar tool calling in sibling SDKs

If the same primitive exists in another Tier 1 project, document file:line refs there too. One combined report may earn the +50% bonus.

### Phase 10 — Conservative scoring

Compute CVSS 3.1 AND CVSS 4.0. Map each metric to evidence from Phase 7/8, not to optimistic interpretation.

Apply program adjustments:
- Vercel OSS: real-world exploitability, default-config bias, experimental penalty.
- Google VRP (OSS): integrity/confidentiality required for ≥ Medium; DoS-only usually rejected.
- Chrome: Critical/High/Medium rubric over CVSS.

Apply bonus modifiers explicitly:
- Vercel OSS: +50% multi-project, +25% patch suggestion, +25% core security feature.
- Score the modifiers against the evidence file, not against narrative.

If the honest score is borderline Medium/High, prefer Medium and document the conditions under which it would be High. Vercel triagers reward conservative framing.

### Phase 11 — Report draft

Each report contains:
- Title — framework-owned root cause + specific vector
- Affected version(s) field — exact versions tested
- Source root cause references — file:line for each contributing line
- Repro commands — exact, copy-pasteable
- Logs/evidence — JSON + raw outputs
- Suggested fix — minimal patch sketch
- Threat model + attacker assumptions — concise
- What is claimed — bulleted
- What is NOT claimed — bulleted (auth bypass, RCE, cross-user leak only when proven)
- CVSS 3.1 + 4.0 vectors and scores — with per-metric justification
- Zip artifact attached

Drafting rules:
- Lead with proof, not narrative.
- No marketing adjectives ("CRITICAL", "DEVASTATING").
- Patch suggestion is concrete, file:line, minimal diff if possible.
- Distinguish primitive / chain / amplifier in the impact section.
- Cite related prior advisories and explicitly explain why this is distinct.

### Phase 12 — Submit + track

Per program:
- Use private channel (HackerOne form, security@, GHSA form).
- Use HackerOne alias email if needed (`h1username@wearehackerone.com` for Vercel).
- Track SLA windows (first response, triage, bounty decision).
- On patch landing, run regression PoC against the fix; if PoC still works, follow up with new evidence.
- On CVE assignment, prep public disclosure plan for +30 days (or program-specific window).

## Anti-patterns

- **Scaffolding bloat.** Carrying 30+ historical threat-model docs from unrelated targets into a new slice audit causes context rot. One target context per session.
- **"Model says vulnerable" without runtime PoC.** Always verify.
- **Overclaiming severity.** Vercel + Google triagers down-grade overclaiming. Conservative framing keeps trust.
- **Reporting exact repeats of public advisories.** Use them as fix-lineage seeds; if you can bypass the prior patch on current canary, the report is novel; if not, do not report.
- **Whole-file source review.** Read slices.
- **Production testing.** Use local builds; never hit live customer endpoints.
- **Bundling unrelated bugs.** One root cause per report unless the program explicitly allows chains.
- **Reporting from `next dev` only.** Most programs treat dev-mode as non-bountied.
- **Ignoring program-specific Tier 3 list.** Vercel pushed non-default-config issues to Tier 3 in March 2026; check before submitting.
- **Mega-MDs for session state.** Long state dumps in `docs/threat-models/` defeat slice discipline. Use `HANDOFF.md` (≤30 lines, schema in `llm-leverage-passes.md` Technique 10) for resume-state. Doctrine lives in `docs/methodology/`. Evidence lives in `bugs/<id>/evidence/`. If the handoff overflows 30 lines, refactor matrix into smaller artifacts, do not lengthen the handoff.
- **Loading two threat-model docs in the same prompt.** Single Active Artifact rule: `HANDOFF.md` + one artifact. To bring a fact from another doc, copy the paragraph; do not attach the file. Stacking docs reduces yield (long-context degradation) even when each doc is well-scoped.
- **Forgetting to rewrite `HANDOFF.md` after closing a Pass.** Trigger is mechanical: every Pass close, every session pause, every active-artifact switch. If a Pass closed and `HANDOFF.md` still points to the previous artifact, the next session restarts from stale state.

## Where to keep artifacts

Recommended layout per target worktree:

```
<worktree>/
├── AGENTS.md                          # program rules + reportability bar
├── docs/
│   ├── program/<program>.md           # Phase 0
│   ├── threat-models/
│   │   ├── YYYY-MM-DD-<target>-minimal-threat-model.md     # Phase 3
│   │   ├── YYYY-MM-DD-<target>-security-advisory-recon.md  # Phase 2
│   │   ├── YYYY-MM-DD-<target>-sink-matrix.md              # Phase 4
│   │   └── YYYY-MM-DD-<target>-N<ID>-<sink>-threat-model.md  # Phase 5/6 per candidate
│   ├── methodology/<target>-vulnhunt-loop.md  # adapt this skill per target
│   └── targets/<target>-paths.md       # quick path map for the codebase
├── targets/<target>/                   # ignored — local clone
└── bugs/<target>/N<ID>-<sink>/
    ├── poc/                            # zip-ready PoC
    ├── evidence/                       # raw curl, JSON, logs
    └── report/                         # draft report
```

## When to use this skill

- Starting a new VRP target — go Phase 0 to Phase 3 in order.
- Returning to a paused target — read existing minimal threat model + sink matrix, pick the next candidate row.
- Independent verification request — go straight to Phase 5/6/7 against the cited slice.
- Drafting a report — Phase 9 to 11.
- Submitting — Phase 12.

The skill is the gravity well; the per-project methodology doc in `docs/methodology/<target>-vulnhunt-loop.md` is where you record what specifically worked for that target (e.g. "Next.js Image Optimizer slices are short and dense, prioritize TOCTOU patterns").
