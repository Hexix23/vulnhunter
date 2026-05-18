# Vulnerability Hunting Methodology

A project-agnostic playbook for going from "I want to review project X" to "I have a reportable finding with a clean VRP submission."

This is a process document. It names no target-specific files. Apply to any target that has public security history and a reachable source tree. Engagement-specific lessons live in the per-engagement retro and revalidation docs alongside the bug submissions; they do not belong here.

## 0. When to use this

Use this when all three conditions are true:

- The target has at least one prior security fix. No prior fix = no fix lineage, no invariants to pressure-test.
- The target has a reachable attack surface you can stand up locally. Pure library review without exercisable input is a different methodology.
- You have time to iterate. Each phase produces artifacts that feed the next. Short-circuiting phases produces false positives or misses impact.

## 1. Phase map

```
Phase A - CVE-derived threat model                   (prior art study)
Phase B - Source-level invariants extraction         (what the code claims)
Phase C - Fix lineage                                (what each patch actually changed)
Phase D - Post-fix hunt matrix                       (where residual bugs live)
Phase E - Entry-point expansion                      (where the initial lens missed)
Phase F - Candidate probing                          (one candidate at a time)
Phase G - Independent adversarial verification       (blind review for false positives)
Phase H - CVSS justification                         (defensible score, not a guess)
Phase I - Report write-up and submission             (VRP-quality, no AI tells)
```

Each phase has: inputs, outputs, artifacts, exit criteria.

## 2. Phase A - CVE-derived threat model

Input: public vulnerability data. CVE advisories, GHSA, vendor security bulletins, issue tracker.

Do:

- Pull every public CVE for the target. Extract CVE ID, class (CWE), affected versions, patched versions, PR/commit reference.
- Read each advisory's reporter description. What sink was exploited. What guard was missing.
- Read the linked patch. What code change landed. What invariant it introduces or restores.
- Group CVEs by bug class and by code region.

Output: one MD document listing bug classes observed, sinks that have failed before, and a first-pass list of trust boundaries the target exposes.

Exit criterion: you can name five places in the target where the history says "attacker-controlled input reached a security-sensitive sink." That is your initial suspicion surface.

Template file: `NN-PRODUCT-cve-derived-threat-model.md`.

## 3. Phase B - Source-level invariants extraction

Input: Phase A suspicion surface. Target source tree.

Do:

- For each area, read the actual code. Not the commit message. Not the PR description. The code at the current commit.
- Identify explicit invariants the code enforces. Usually they show up as regex validators, allowlist checks, type guards, sanitization functions.
- Identify implicit invariants the code assumes. Usually they show up as things the code does not guard because it trusts an upstream caller.
- Enumerate the inputs each invariant is supposed to protect against.

Output: a numbered list of invariants. Each invariant has: the statement, the code that enforces it (file:line), the statement of "violated if."

Exit criterion: every invariant has at least one cited file:line and one realistic "violated if" sentence. Vague invariants go back for another read.

Template: `NN-PRODUCT-invariants-and-threat-mapping.md`. Later phases add "Post-fix status" entries to each invariant.

Key trick: do not write invariants for code you have not read. Missing invariants are fine. Wrong invariants kill the rest of the methodology.

## 4. Phase C - Fix lineage

Input: the patches referenced by Phase A CVEs. Target repo git history.

Do:

- For each patch, identify: bug class addressed, files changed, shape of the change (regex added, allowlist introduced, validation gated, etc.), invariant it tried to enforce.
- Critical question for each: was the patch a targeted fix (one specific payload shape) or a class fix (addresses all variants)? Targeted fixes are candidate reference points for "ñapa" findings - the patch closed the reported case, nothing more.
- For each patch, cross-check whether the shipped runtime bundle matches the source the patch modified. Build systems can strip, inline, or reshape source. Bundles are what users run.

Output: a lineage document with one section per patch. Each section has: bug class, code change, invariant introduced, residual hypotheses.

Exit criterion: for every prior CVE you can answer "was that a class fix or a targeted fix?" If it was targeted, you have at least one residual hypothesis written down.

Template: `NN-PRODUCT-fix-lineage.md`.

## 5. Phase D - Post-fix hunt matrix

Input: residual hypotheses from Phase C.

Do:

- Turn each residual hypothesis into a candidate. A candidate has: priority (P1/P2/P3), claimed invariant, code signal, likely sink, test shape, reportability bar.
- Priority is set by: (blast radius if exploit works) × (probability the test shape reproduces) × (reachability of the sink).
- Write the "test shape" concretely. What payload, what code path, what observation would confirm. This is the spec for Phase F.

Output: a matrix of candidates. Typically 5-10 initial candidates.

Exit criterion: candidates are ordered, test shapes are concrete, reportability bars are specific. Vague candidates like "review the parser" go back for another pass.

Template: `NN-PRODUCT-post-fix-hunt-matrix.md`.

### D.5 LLM leverage passes (operational)

Before declaring the matrix ready for probing, run the LLM-heavy passes in `llm-leverage-passes.md`:

- Pass 1 — patch-diff variant farm (highest yield; fix-lineage seed).
- Pass 2 — parser / serializer differential.
- Pass 3 — symmetry / dual hunt.

Each pass takes a section of the matrix and 3-5x expands the candidate count without adding boundaries — it adds variants per boundary already on the map. Candidates emitted by these passes feed Phase F slicing.

Exit criterion for D.5: at least one variant from each pass landed in the matrix as a new row, or you can justify in writing why a pass returned nothing.

## 6. Phase E - Entry-point expansion

Input: the candidate list and the source tree.

Do:

- The candidate list is always narrower than reality. Deliberately zoom out and enumerate every trust boundary in the project that accepts external input. Do not filter for plausibility yet.
- Typical boundaries: HTTP request headers, HTTP request body, URL path/query, WebSocket frames, file uploads, inter-service RPCs, config files parsed at runtime, environment variables, CLI args, schematic/codegen inputs, dev-server middleware, build-time hooks.
- For each boundary: what input enters, what validation currently exists, what sinks consume it, what bug classes are plausible.
- Before complex chains, run a basic primitive sweep for each boundary: absolute-form URLs, protocol-relative URLs, backslashes, duplicate/comma-joined headers, `Forwarded`/`X-Forwarded-*`, explicit ports, default ports, IPv6/IDNA, encoded separators, redirects, retry/fallback paths, and lower-level public APIs that bypass wrapper validation.
- For each primitive, compare the raw input, the normalized value that validation checks, and the representation consumed by the sink. A mismatch is a first-class candidate even if it looks "too simple."

Output: an entry-point map with one section per boundary.

Exit criterion: you can name 10-15 boundaries, and each boundary has either passed the basic primitive sweep or is explicitly marked N/A. If you can only name 3, or if the primitives were skipped because you were chasing a deeper chain, you have not looked hard enough.

Template: `NN-PRODUCT-expanded-entry-points.md`. When this document is written, feed each new boundary back into Phase B (invariants) and Phase D (candidates).

Why this phase exists: every engagement I have seen that produced a reportable finding found the finding in a boundary outside the initial suspicion surface. Entry-point expansion is the step that avoids tunnel vision.

## 7. Phase F - Candidate probing

Input: one candidate from the matrix.

### F.0.4 Prior-art duplicate check (mandatory, broader than GHSA)

Public GHSA recon is necessary but NOT sufficient to rule out
duplicates. Real-world experience: candidates can be marked duplicate
by triage even when no published GHSA matches. Causes:

- A different reporter submitted the same primitive recently and
  triage is still processing it. No GHSA issued yet.
- The bug is in the vendor's internal security-issue queue but not
  externally announced.
- The class is acknowledged in a closed GitHub issue without security
  label.
- The fix was merged silently in a recent commit; no GHSA emission
  yet because vendor batches advisories.

Before submitting any candidate, check all of:

1. **Published GHSAs** for the program — covered by Phase 2 recon.
2. **HackerOne hacktivity feed** for the program — look for
   recent disclosed reports with matching keywords.
3. **GitHub issues** with `security` / `bug` / `xss` / `ssrf` /
   `auth` / `cache` labels referencing the same file or function.
4. **Closed PRs** with security-adjacent commit messages
   (`fix(security)`, `harden`, `validate`, `sanitize`) touching the
   target sink in last 6 months. Even if PR has no CVE link, the
   maintainer may treat the issue as known.
5. **Public blog / Twitter / conference talk** mentioning the sink
   or the same primitive. Search the function name and file path.
6. **Vendor security blog** beyond GHSA emissions (some vendors
   publish hardening posts that mention the class).

If any of these returns a hit that plausibly covers the candidate,
the report is at high duplicate risk. Either:
- Find a clear novelty angle (post-patch bypass, broader impact,
  different reachability) and document it explicitly in the report
- Park as known-class hardening request

Anti-pattern: relying on GHSA-only check, missing internal queue
items, getting duplicate verdict at submission and losing
credibility plus burning the report-channel slot.

### F.0.3 Documentation-disclosure gate (mandatory, ordered FIRST)

Before any Phase F PoC build, check if the framework already documents
the unsafe behavior and provides a mitigation knob. Read the official
docs section for the affected sink/feature end-to-end, including the
"Notes" and "Caveats" subsections that ship in many doc generators.

Test: "Does the framework docs explicitly disclose this behavior AND
provide a config knob to disable / restrict it?"

If yes → vendor triage will mark "working as documented". Park as
**hardening request** (suggest hardening the default config or
removing the documented escape hatch). Do NOT submit as vulnerability.

This is DISTINCT from F.0.2 (consumer-bug). A behavior can be:
- Framework-native (passes F.0.2) AND
- Documented as intentional (fails F.0.3)
- → still not a vulnerability under vendor rules

Example failure mode: candidate sink in code is technically unsafe;
docs at the sink's reference page contain a paragraph like
"Note that <unsafe-behavior> happens; use <config-flag> to mitigate."
Vendor's stance: documented, configurable, not a vulnerability.

To upgrade despite documentation, you must show ONE of:
1. The documented mitigation does NOT actually mitigate the attack
   (false documentation).
2. The default config still exposes the attack and the documented
   mitigation is non-default + non-discoverable (most users miss it).
3. The exploit chain reaches a different impact than the docs warn
   about (e.g. docs warn about "image content swap"; you prove
   "session cookie leak via the same primitive").

Always grep the docs for the sink's identifier (function name,
config key, route prefix) and the corresponding mitigation flag
BEFORE building PoC. The vendor's documentation is the vendor's
defense in triage.

### F.0.2 Native-vs-consumer gate (mandatory, ordered FIRST)

Before any Phase F PoC build, answer this question:

> "If the consumer app follows the documented canonical pattern from
> the project's official docs, does the exploit still fire?"

If the answer is NO — the documented pattern includes a guard that
blocks the attacker (auth check, opt-in flag, sanitization wrapper,
secret comparison, capability check) — and that guard is NOT itself
bypassable at framework level, then the exploit is **consumer-bug**.

Consumer bugs are NOT VRP-reportable as framework vulnerabilities.
Park as hardening request / defense-in-depth note. Do not write a PoC,
do not run Phase G, do not draft a report.

To upgrade a candidate from consumer-bug to framework-native, you must
show ONE of:

1. **Framework-internal caller**: the vulnerable sink is reached by
   framework code without passing through user handler code at all.
   Grep callers of the function; if all callers are user-handler
   exposure, the sink is consumer-gated.
2. **Documented-gate bypass at framework level**: the guard the docs
   require (e.g. `req.query.secret !== TOKEN`) can be bypassed via a
   framework parser quirk (e.g. header injection that pollutes
   `req.query`, parser differential between user code and framework).
3. **Sibling sink without consumer gate**: another sink with the same
   unsafe pattern that is NOT gated by user code (e.g. framework
   middleware, automatic background task).

Test: "Would the official `Hello World` / `Getting Started` example
from the docs exhibit this exploit if pasted unmodified?" If no →
consumer bug, park.

Rationale: VRP programs (Vercel OSS, Google VRP, Angular Security) all
explicitly reject "obviously vulnerable application code" reports. The
test above is the same test the triage engineer applies. Apply it
yourself before investing PoC time.

Anti-pattern: PoC that omits a guard the official docs mandate, then
claims "framework bug" because the unguarded path leaks. That is
consumer code that happens to expose a framework defense-in-depth gap.
File as hardening, not as vulnerability.

### F.0.1 Production deployment verification (mandatory)

Before classifying any candidate as confirmed, identify the exact runtime that serves real users in production. Targets often ship multiple runtimes — a development tool, a build-time pipeline, and a production runtime — and a bug may exist in only one of them. The PoC must reproduce against the runtime that real deployments expose, not against a dev tool, a source-tree test harness, or a hand-rolled bootstrap.

The PoC's build steps must be the canonical user-facing flow shipped by the project. Use the project's documented "create new project" / "release build" / "package" commands. Run the artifact those commands produce, exactly as a real deployment would.

Each PoC's README must state explicitly:

1. Which runtime it targets (the production-facing surface).
2. Which runtime(s) it does NOT target (development server, test harness, internal tool).
3. The exact build command that produces the tested artifact.
4. Where the tested artifact lives on disk after build.

Findings against dev tools, schematics, build-time hooks, or source-tree test harnesses are still reportable when the project ships them, but the report's reachability section must state so explicitly. Do not silently mix dev-time and production findings — triagers and downstream reviewers cannot tell the difference, and CVSS reachability values diverge sharply between the two surfaces.

### F.0 Slice discipline (read this before every probe)

Long-context LLMs degrade as input grows even when content is relevant ("context rot"). Past engagements have stacked multi-tens-of-KB invariants/lineage/matrix documents into a single agent prompt; refusals and shallow analysis followed. Apply this before any agent call:

- **Thin slice per probe**: pass exactly one candidate row, the file:line range it cites (≤ 200 lines of source), and the contract sentence it violates. Nothing else.
- **No doc stacking**: invariants doc, fix-lineage doc, and full hunt matrix are reference material. They do not enter the probe prompt. If the agent needs a fact from them, paste the one paragraph.
- **One slice = one boundary**: when the boundary changes (HTTP header → build hook → IPC), open a new slice doc. Do not extend the previous doc.
- **Cap the prompt at ~3 KB of project text**. If you exceed this, you are giving the agent a research project, not a probe.
- **Adversarial framing, not audit framing**. Ask "demonstrate the bug at file:line N — exploit, not assessment". Asking "is this safe?" produces rationalization. (See Phase F.1.)
- **Comparative anchor when one exists**: paste the known-good sibling and ask why this one is different. This converts vague review into diff-driven review.
- **Refresh between rounds**: after a probe closes, archive its slice. Do not let the next probe inherit it. The agent should start each round with a clean working set.

Failure mode this prevents: piling docs into the prompt feels productive (more context, more thoroughness) but the agent reasons across less of it as the prompt grows. Compression is the discipline that keeps yield up.

### F.1 The probe loop

Do, one candidate at a time:

1. Read the code the candidate cites. Cite file:line for every claim. If you cannot cite, you have not read enough.
2. Build a hypothesis: "if input X reaches sink Y through path Z, outcome W follows."
3. **Frame adversarially in the agent prompt**: "function at file:line N has a bug of class C. Write an exploit that demonstrates outcome W. The exploit must run end-to-end against the canonical build." Do not ask the agent to assess whether the bug exists; ask it to demonstrate.
4. Minimally reproduce. Prefer the smallest PoC that demonstrates the chain end-to-end, against the canonical build/run steps the project documents (not a hand-rolled bootstrap).
5. Observe. Cite the exact command and the exact output. Never paraphrase outputs.
6. Classify: confirmed exploitable / confirmed gap not exploitable / refuted / inconclusive.

Output per candidate: a PoC directory with `poc/`, `evidence/`, and a `WALKTHROUGH.md`.

Exit criterion for each candidate: the classification is supported by an observable artifact (log line, HTTP response, process behavior). "I think this works" without an artifact is inconclusive, not confirmed.

Anti-patterns to avoid:

- Rigging the PoC app. If the exploit only works when you write unusual code in the consumer, that is a consumer bug, not a target bug. Write the consumer in the most natural way first; then show that the natural way exhibits the problem.
- Using hand-crafted bootstraps instead of the canonical project scaffold. Hand-crafted bootstraps produce false positives because they bypass integrity checks the canonical build applies.
- Testing against the source tree when the bundle is what users run. The bundle can differ. Always test against what ships.

### F.2 Adversarial slice farm (parallel)

Phase F is parallelizable up to roughly 8 concurrent slices via `codex-rescue`. Per-slice budget: ≤100 LOC source, ≤3 KB project text in the prompt, one contract sentence, adversarial framing. See Pass 4 in `llm-leverage-passes.md` for the prompt template.

Anti-patterns specific to slice farming:
- Sharing a single prompt across slices "for efficiency" — context bleed produces convergent FPs.
- Letting the slice exceed 100 LOC because "the function is long" — split it.
- Running concurrency higher than 8 — rate limits saturate without yield improvement.

### F.1.1 Technique-catalog probe matrix (mandatory)

Runtime probes for a candidate MUST NOT be limited to inputs the
source-level analysis suggested. Source review produces hypotheses; the
hypotheses are biased toward what the researcher could see in code. The
real input space is the vendor-neutral technique catalog for the bug
class.

For each Phase F candidate, build a probe matrix BEFORE declaring
confirmed or refuted. Coverage requirements per bug class:

- **SSRF**: PayloadsAllTheThings/Server%20Side%20Request%20Forgery —
  authority confusion (userinfo, fragment-@, query-@), slash variants
  (//, ///, \\, %2F%2F, %252F), IP encoding (decimal, octal, hex, IPv4
  short, IPv6 mapped, IPv6 literal, 0.0.0.0, nip.io), absolute URI
  request-target (http/https/gopher/file), CRLF injection, Host header
  trust (Host, X-Forwarded-Host, X-Forwarded-For, X-Original-Host,
  Forwarded RFC7239), DNS rebinding/multiple-A.
- **XSS**: PayloadsAllTheThings/XSS%20Injection — polyglot payloads,
  context (HTML/attribute/script/style/URL), CSP bypass, mutation,
  framework-specific bypasses.
- **Path traversal**: encoded variants (%2e%2e, %252e, /./, /;), null
  byte, UTF-8 overlong, OS path separator (\\ vs /), zip-slip,
  Windows alternate streams.
- **Open redirect**: PayloadsAllTheThings/Open%20Redirect — same shape
  as SSRF authority confusion plus protocol-relative, javascript:,
  data:, CRLF in Location.
- **Deserialization**: per-language gadget chains (ysoserial,
  Marshalsec, phpggc), prototype pollution payloads, polyglot.
- **HTTP request smuggling**: CL.TE, TE.CL, TE.TE, HTTP/2-to-HTTP/1
  desync, chunked-encoding tricks.

Slice discipline still applies (one candidate per session). The matrix
itself is a SINGLE artifact added to the candidate slice doc. Breadth
on INPUTS, not breadth on candidates.

Anti-pattern: declaring "refuted" after 5-10 narrow probes derived
from source-level intuition. Declaring confirmed/refuted requires the
catalog matrix.

### F.3 Blind dual verification

Between Phase F and Phase G, every candidate gets two independent LLM sessions:

- Session A — adversarial framing, "this slice IS vulnerable, prove it".
- Session B — defensive framing, "argue why this slice is safe".

Escalate to Phase G only when both verdicts agree on vulnerability class. Disagreement is recorded as data, not averaged.

## 8. Phase G - Independent adversarial verification

Input: a candidate you classified confirmed in Phase F.

Do:

- Spawn an independent reviewer with no context from your own work. Same codebase, same running PoC, different session. Ask them to either confirm or refute with evidence.
- The reviewer should read the code blind. They should not see your notes, your writeup, your analysis. They see only the claim, the running resources, and the raw source.
- Ask the reviewer specifically to argue for false positive. If the reviewer cannot argue FP convincingly, that is stronger signal than a reviewer who only tries to confirm.
- If the reviewer finds a specific inaccuracy in your claim, correct the claim before Phase I. Do not paper over it.

Output: a second WALKTHROUGH or a comment trail on the first one, with the reviewer's verdict and any corrections applied.

Exit criterion: at least one independent reviewer reproduced the exploit or cited a specific reason it does not reproduce. If reviewer is inconclusive because of environment issues (sandbox, network), it does not count as confirmation.

Key operational detail: if the reviewer runs in a sandbox that cannot reach the network or cannot write to `/tmp`, their verdict is structurally weaker. Fix the sandbox or pick a different reviewer.

## 9. Phase H - CVSS justification

Input: a confirmed finding with known impact.

Do:

- Start from the impact you actually demonstrated, not the worst-case scenario you can imagine. Score that first.
- For each metric, cite the CVSS 3.1 spec section that applies. `C:H` says "steals the administrator's password" as its canonical example. If your finding gets cloud metadata credentials, cite that text. If your finding gets a login cookie, cite that text. If you cannot find a spec-level hook, downgrade.
- For Scope, walk the security authority argument carefully. Cloud metadata endpoints, identity providers, co-hosted admin services, and cross-tenant storage are separate authorities. Same-process databases are typically not.
- Produce three vectors: conservative (minimum upgrade justifiable), realistic (probable in real deployments), aggressive (worst-case). Include the computed score for each.
- Recommend the realistic vector for submission. Triage engineers at bug bounty programs accept realistic, not aggressive.

Output: a severity section in the VRP report with the table of three vectors and the recommended one.

Exit criterion: for each metric (C, I, A, S, AC), you can cite spec text or a specific demonstrated outcome that supports the value. No hand-waving.

Common mistake: inflating `I` without evidence. Integrity-impacting exploits have specific shapes (cookie takeover, OAuth redirect_uri steering, canonical link injection that users click). If your PoC did not demonstrate one, `I:L` or `I:N` is the honest value.

## 10. Phase I - Report write-up and submission

Input: confirmed finding, evidence, CVSS, fix recommendation.

Do:

- Produce two documents: a VRP-technical report and a non-technical explainer.
- VRP report structure: product/version/component/CVE-type/CVSS, Description, Impact, Steps to Reproduce, PoC, Evidence, Suggested Fix.
- Explainer structure: What We Found, Who Is Affected, What Could Happen, Recommendation.
- Both documents must be reproducible by a reviewer in under 5 minutes from a clean environment.

Anti-AI-tell pass:

- No em-dashes. Use plain hyphens or rewrite as two sentences.
- No triadic structures ("first, second, and third"). Use asymmetric lists.
- No hedge words like "it is worth noting," "notably," "importantly," "crucially," or triple-decker adverb chains.
- No emojis unless the target ecosystem uses them.
- No overly comprehensive bullet lists that feel AI-exhaustive. Two to five items is human. Ten is AI.
- Specific verbs over abstract ones. "The patched getter returns the raw string" beats "The patched mechanism may potentially expose unvalidated data."

Build a submission zip:

- Include `poc/` and `evidence/`. Do not include the VRP report or explainer in the zip; those paste into the submission form.
- Verify the zip is self-contained. Unpack it to a fresh directory as a triager would, follow the README, confirm the exploit reproduces.

Output: the VRP form fields (description, vulnerability type, CVSS, reproduction steps) plus the zip attachment.

Exit criterion: a fresh-context triager can reproduce the exploit from the zip in under 5 minutes.

## 11. Cross-cutting techniques

### Clean-room reproduction

Every submission should include a reproduction that works from a completely clean environment: fresh scaffold directory, fresh process list, fresh port allocations, fresh secrets. The reproducibility test is: tear everything down, unzip the submission to a new path, follow its README, observe the exploit. If timestamps in the output are fresh and the exploit chains end-to-end, you have a submission.

### Timestamp-unique secrets

Victim servers / sinks should return identifiers that include a per-run timestamp. When the triager reproduces, the timestamp in their output will match their run, not yours. This eliminates the "you baked the exploit into the static HTML" false-positive hypothesis.

### Three-probe isolation

Every PoC should include three probes: baseline (no attacker input), exploit (the actual payload), control (a variation that the defense correctly rejects). The three together rule out "the app always returns this" (baseline), "the defense is fully broken" (control), and prove only the specific gap (exploit).

### Parser differential hunting

When you see a validator that checks syntax and a downstream consumer that parses the same value, look for parser differentials. Common ones: WHATWG URL vs regex, HTML parsers vs browser DOM, JSON parsers vs V8 JSON.parse, YAML safe vs unsafe loaders. Each parser pair is a class of bug.

### Contract-violation framing

When a function is documented or named to "validate" but only validates a subset of its input (first token, first match, leading segment), the subset-validation is a contract violation. Frame reports in terms of the violated contract, not just the exploited sink. Contract framing is more defensible because it removes the counterargument "that's an app bug, not a framework bug."

### Severity scales with sink

A framework-level primitive can score anywhere from Low (lab-only) to Critical (automatic compromise) depending on the downstream sink. Report the realistic sink, not the theoretical worst case. If the realistic sink reaches cloud metadata, you are at C:H/S:C. If the realistic sink reaches logging, you are at C:L/S:U. The framework gap is the same; the score is not.

## 12. Artifact template directory

For each engagement, expect this directory layout:

```
docs/
  threat-models/
    DATE-PRODUCT-cve-derived-threat-model.md
    DATE-PRODUCT-invariants-and-threat-mapping.md
    DATE-PRODUCT-fix-lineage.md
    DATE-PRODUCT-post-fix-hunt-matrix.md
    DATE-PRODUCT-expanded-entry-points.md
    DATE-PRODUCT-candidate-N-audit.md  (per closed candidate)
    DATE-PRODUCT-end-to-end-poc.md     (per reportable finding)

bugs/
  PRODUCT/
    SHORTNAME/
      poc/
        README.md
        (source files needed to reproduce)
      evidence/
        (logs, curl transcripts, server output)
      report/
        VRP_REPORT.md
        EXPLAINER.md
      WALKTHROUGH.md                   (for your own reviewers)
      SHORTNAME-submission.zip        (poc/ + evidence/ only)
```

## 13. Rules

1. Read code before writing invariants.
2. Cite file:line for every code claim.
3. Reproduce against the canonical build, not a hand-rolled scaffold.
4. Test the shipped bundle, not only the source.
5. One independent blind reviewer before declaring confirmed.
6. Three probes (baseline / exploit / control) in every PoC.
7. Timestamp-unique secrets in every sink.
8. Realistic CVSS, not aggressive.
9. Contract-violation framing when the bug is at a trust boundary.
10. Clean-room reproduction on every submission.
11. No AI tells in any file that ships to the VRP.
12. Slice discipline: one candidate, one slice, ≤3 KB of project text in any agent prompt.
13. Adversarial framing: ask the agent to exploit a stated bug, not to find or assess one.
14. Archive slice docs between probes; never extend a slice across boundaries.
15. Refresh threat model when prior CVEs all share one channel — the unmapped boundaries are the next hunt.
16. Host-OS infra differences are part of the toolchain budget. macOS lacks `timeout`; Linux lacks BSD-flavored `sed -i ''`; Windows lacks POSIX shell semantics. Identify and pin the equivalents at engagement start, do not let agents discover them mid-probe.
17. Pin runtime/interpreter binaries by absolute path in every agent shell command. Do not rely on `export PATH` for sub-shells; agents lose env between turns and silently fall back to whichever bare `node`, `python`, `ruby` resolves first. Use the project's declared engines/runtime version, not the system default.
18. When local PoCs hit a framework's own input-validation defenses (default-deny allowlists, host validators, CSRF tokens), set the framework's documented opt-in mechanism explicitly (env var, config flag). Otherwise the framework falls back silently to a different code path and your probe measures the wrong sink.
19. Identify the ceiling of your instrument before you compete with it. Where industrial-scale machinery already covers the surface (continuous fuzzing farms, billion-sample regression detectors, vendor static-analysis pipelines), do not write a hand-rolled equivalent — you are 3 orders of magnitude behind on day one. Instrumentalize what exists: run the public fuzzers, consume the patch streams, read the issue trackers. Spend cognitive effort where the existing machinery cannot: patch-diff variant hunting, spec differential, source audit of optimization / transformation passes, cross-component pattern transfer, semantic post-triage of corpora. Phase F probing for high-investment targets is a triage and reasoning loop, not a tooling-build loop.
20. Write `HANDOFF.md` (≤30 lines, schema in `llm-leverage-passes.md` Technique 10) at three trigger points: after closing any Pass output doc, before any session pause, before expected context compaction. Long sessions compress; the compression keeps the thread but drops file:line specifics. A short on-disk note survives compaction because it lives outside the model's context window. If you cannot summarize state in 30 lines, slice discipline failed earlier — refactor the matrix into smaller artifacts, do not bloat the handoff. No mega-MDs.
21. **Single Active Artifact rule**. To start any Pass, prompt, or agent call, read only `HANDOFF.md` plus the one artifact `HANDOFF.md` currently points to. Never load two prior Pass outputs into the same prompt; never attach multiple threat-model docs as context. If you need a fact from a prior artifact, copy the single paragraph in. Prior artifacts are reference, not working context. The Pass output schema (`Pass N+1 input` section) is the contract that carries forward; everything else stays on disk and out of the prompt. Stacking docs feels thorough but reduces yield because long-context LLMs degrade as the input grows.

## 14. Common failure modes

- Writing invariants for code you haven't read. Every wrong invariant leads to wrong candidates in Phase D.
- Testing against source when users run a bundle. The bundle can differ; only the bundle is ground truth for shipped versions.
- Accepting a reviewer's inconclusive verdict as refutation. Inconclusive means retry with a working sandbox, not "not a bug."
- Scoring CVSS before confirming impact. Score after you observe the outcome, not from the claim.
- Submitting without clean-room reproduction. Old processes, old ports, old env vars leak into the PoC and produce false positives the triager catches.
- Framing a contract violation as a direct SSRF when it requires consumer cooperation. Triagers mark this down as "app-level bug" and reject. Framing as contract violation preserves reportability.
- Anchoring on the CVE-shaped surface. If every prior CVE in your Phase A list is the same class on the same channel, your Phase D candidates will mirror that bias. Force diversity at Phase D and re-enter Phase E if needed.
- Stacking docs in agent prompts. Invariants + lineage + matrix + fix audit + entry-points = context rot. The agent stops reading carefully past the first 3-5 KB and starts pattern-matching. Pass one slice, period.
- Asking the agent "is this safe?" Vague invitation to rationalize. Ask the agent to demonstrate the bug at the specific file:line you cite.
- Letting slice docs accumulate across rounds. Each closed candidate's slice is archived; the next round opens a new slice. Otherwise the working set grows monotonically and the agent's effective context shrinks.

## 15. When to stop

You are done with the hunt when one of these holds:

- Every priority-1 candidate is closed (confirmed-reportable, confirmed-gap-not-exploitable, or refuted with evidence).
- You have two or more reportable findings in the current engagement and the marginal value of another candidate is lower than submission polish.
- Returns have diminished: three consecutive candidates probe to inconclusive or refuted, with no new code paths surfacing.

Stop before you burn credibility with the VRP program by submitting borderline findings.
