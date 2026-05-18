# Threat Model Expansion — Generic Methodology

Companion to `vulnhunt-methodology.md`. This document is **target-agnostic**: web framework, native library, OS kernel, mobile runtime, blockchain VM, ML pipeline. The phase covered here is **before** hunting — when you have a target and need to map its surface beyond the obvious entry points named by prior CVEs.

The failure mode this addresses: anchoring on the CVE-shaped attack surface and missing every boundary the original fix did not visit.

## Output of this phase

Two artifacts that feed the hunt loop:

1. `<date>-<target>-invariants.md` — every claim the framework makes about input safety, with the residual doubt for each.
2. `<date>-<target>-hunt-matrix.md` — 15-25 candidates spanning at least 3 vulnerability classes, prioritized P1/P2/P3.

Both consumed by the hunting agent (codex/claude/manual). Diversity is enforced (no class >50% of P1) — this is the anti-anchoring rule.

## 30-minute checklist (apply per target)

The five techniques below, in order, produce the artifacts above.

1. **API surface mining** (5 min) — three-layer enumeration
2. **Inverse fix lineage** (5-10 min) — read every prior CVE and ask what they did NOT touch
3. **Boundary inventory** (10 min) — list every place data crosses a trust boundary
4. **Symmetry / dual checks** (5 min) — for each input validator, find the dual on output
5. **CWE-driven matrix** (5 min) — for each CWE relevant to the architecture, ask where it could manifest

Output: 15-25 candidates, 3+ classes. If your list bunches into one class, your sweep was anchored. Re-run from technique 3 with explicit class diversity gate.

---

## Technique 1 — API surface mining (3-layer)

Most targets advertise a small public surface and expose a much larger semi-private surface that isn't documented. Each layer is a separate hunt.

| Layer | What it is | Where to look | Why it matters |
|---|---|---|---|
| 1. Documented | Public API in official docs | `docs/`, `*.md`, JSDoc/TSDoc, type declarations | Has explicit contract → invariants are clear → break each one |
| 2. Public exports | Symbols re-exported from package root | `public_api.ts`, `index.ts`, `__init__.py`, `lib.rs` `pub` | Accessible by consumers but often broader than docs → contract gaps |
| 3. Private exports | Internal symbols accessible if you bypass the recommended import path | `ɵ`-prefixed (Angular), `_` prefix (Python), `pub(crate)` (Rust), unexported but callable | No contract → invariants vague → boundary crossings frequent |

For each layer:

- List every export.
- For each, write the one-sentence contract: "This function ASSUMES X and PROMISES Y."
- The hunt is: violate X, observe whether Y still holds.

**Warning**: layer 3 hits are often dismissed as "not reachable in real apps". Counter with: produce a real-world consumer call site (npm/PyPI/crates.io grep). If you find one, layer 3 hits are reportable. If you don't, document them as "future-reportable when consumer emerges" and move on.

## Technique 2 — Inverse fix lineage

Every prior CVE / GHSA / patch is a **map of what the developer thinks the surface is**. The unmapped territory is where the next bug lives.

Process:

1. For the target, list all CVEs, security advisories, and major bug-fix PRs.
2. For each, read the patch diff, not the description. Identify:
   - **What lines changed** (the fix)
   - **What lines did NOT change but are adjacent** (untouched neighborhood)
   - **What invariant the fix asserts** (e.g., "this regex now rejects `..`")
3. The hunt: violate the new invariant via a path the fix did not cover.

Example shapes (target-agnostic):

| Fix shape | Adjacent surface to test |
|---|---|
| Added input validation regex | Encoded variants of the rejected chars (`%2e%2e` for `..`, etc.) |
| Patched authorization check on route A | Routes B/C/D with same authorization need |
| Sanitized one sink | Other sinks consuming the same data |
| Added rate-limit / size-limit | Pre-limit operations (parsing, allocation) and post-limit operations |
| Tightened parser | Older parser versions still in compatibility code paths |
| Fixed memory bug in function X | Functions that call X with the same patterns |

**Heuristic**: if 5 CVEs in a row all touch the same file but none touch its sibling, the sibling is your candidate.

## Technique 3 — Boundary inventory

The most under-applied technique in junior threat modeling. Most threat models start at "HTTP request input" and stop there. The full inventory has 8-10 boundaries.

For any target, walk this table and identify each boundary's existence (mark N/A if not present):

| Boundary | Examples |
|---|---|
| **External → Server input** | HTTP request, gRPC, websocket, SSE, custom protocol, message queue consumer, file upload |
| **Server → External outbound** | Outbound HTTP fetch, DB query, message queue producer, webhook, RPC client |
| **Server → Storage write** | Filesystem (`fs.writeFile`, `open(O_WRONLY)`), DB write, cache write, log emit |
| **Server → Storage read** | Filesystem (`fs.readFile`), DB read, cache read, manifest load, asset load |
| **Server → Client output** | Response body, response headers, cookies, redirect Location, hydration JSON, server-sent events |
| **Build → Runtime** | Generated manifests, embedded constants, prerender output, scaffolding-generated code, codegen |
| **Configuration → Runtime** | env vars, JSON/TOML/YAML configs, schema validation, CLI args, feature flags |
| **IPC internal** | Worker threads, child processes, message channels, broadcast channels, shared memory |
| **Plugin / 3rd-party** | npm deps, vendored libs, schematic packages, optional bundled tools |
| **Client cache → Server** | Service worker fetch, conditional GET, Etag/If-Modified-Since revalidation |

For each boundary that exists in your target, the questions are:

- Is there a validator at this boundary?
- Is the validator's character class / structure check tight enough to match the downstream parser?
- Does the boundary preserve attacker-controlled bytes through to a sink?
- Is there a cache, memoization, or singleton that crosses this boundary?

Each "no/maybe" is a candidate.

**Anti-anchoring rule**: if your candidate list does not include at least one entry from 5+ rows of this table, the inventory was incomplete. Go back.

## Technique 3.5 — Basic primitive sweep

Before inventing multi-step exploit chains, pressure-test each boundary with
the simplest forms attackers use to confuse validators and downstream parsers.
This sweep is mandatory for every boundary that has URL, header, path,
manifest, cache-key, serializer, or generated-code semantics.

Minimum primitive set:

| Primitive family | Shapes to test |
|---|---|
| URL authority | absolute-form, origin-form, protocol-relative, backslash, mixed slash |
| Header authority | `Host`, duplicate `Host`, comma joins, `Forwarded`, `X-Forwarded-*` |
| Port / address | default port, explicit port, IPv6 brackets, IPv4-mapped IPv6, IDNA |
| Path normalization | encoded separators, dot segments, percent-decoding order, case folding |
| Redirect / retry | post-redirect validation, retry URL rebuild, fallback handler |
| Lower-level API | public core API without wrapper validation, internal helper exported by package |
| Serializer differential | cache key, hydration state, manifest, body, generated code |

For each row, answer:

- What exact raw value crosses the boundary?
- What normalized representation is validated?
- What representation does the sink consume?
- Is the validator absent in a lower-level exported API even if a wrapper has it?
- Does the current patched version still accept a sibling primitive?

Stop condition: if the boundary has not passed this sweep, do not mark the
surface "reviewed". This prevents missing basic CVE-class bugs while chasing
rarer RCE or cache-poisoning chains.

## Technique 4 — Symmetry / dual checks

Every input validator implies a dual on the output side (or vice versa). When a target has only the input-side validator, the output-side is unprotected — and consumers downstream of the missing dual are surface.

The pairs to look for:

| Input-side check | Required output-side dual |
|---|---|
| `validateRequest(req)` | `validateResponse(res)` — does the framework re-check headers it sets? |
| Authentication on inbound | Authorization on cache lookup / hydration restore |
| Sanitization on receive | Sanitization on emit (if the value transits multiple parsers, re-check after each) |
| Allowlist on hostname | Allowlist on outbound destination |
| Char-class regex on input | Char-class regex on URL construction / response header writes |
| Validation in primary handler | Validation in error / fallback / retry handler |
| Validation pre-cache | Re-validation post-cache (because cached value may have been written under a different security context) |

**Heuristic**: in a healthy codebase, every input validator has a comment or commit referring to the dual. If the comment is absent, the dual is probably absent.

## Technique 5 — CWE-driven matrix

For each CWE class, ask: "given this target's architecture, where could this manifest?" Walk the matrix even if a class seems irrelevant — sometimes the relevance shows up in a build-time path or an IPC channel you didn't list.

| CWE | Where to look in any target |
|---|---|
| 22 (path traversal) | Anywhere a request input crosses into `path.join`, `os.path.join`, file open, asset lookup. Also URL → path resolvers. |
| 79 (XSS) | Template rendering, sanitizer bypasses (`bypassSecurityTrust*`, `dangerouslySetInnerHTML`, `safe`), error message HTML, log viewer UI, debug pages. |
| 89 (SQLi) / NoSQLi | Query builders fed user input, raw query strings, search filters, ORM `where` clauses with attacker keys. |
| 78 (command injection) | Anywhere user data reaches `child_process`, `subprocess`, `exec`, shell-like template, build-tool plumbing. |
| 502 (deserialization) | `JSON.parse` of attacker bytes, `pickle.loads`, `Marshal.load`, custom binary parsers, hydration state restoration. |
| 444 (request smuggling) | Pipelines where request line / body is parsed twice (e.g., reverse proxy + framework), body re-read after consumption, dual-encoding parsers. |
| 209 (info disclosure) | Error responses, stack traces in dev mode, debug headers (`X-Powered-By`, `Server-Timing`, `X-AspNet-Version`), source maps in prod. |
| 601 (open redirect) | `Location` header, `window.location`, router.navigate from request input, OAuth callback handlers. |
| 918 (SSRF) | Outbound fetch with request-derived URL, image proxies, webhook senders, link previewers. |
| 287 (improper auth) | Auth checks that compare wrong field, that reuse session across security boundaries, that run after the privileged operation. |
| 384 (session fixation) | Session ID acceptance from cookies/URL/headers without rotation on auth, session reuse across users. |
| 798 (hardcoded credentials) | Default tokens, debug bypasses, well-known dev modes. |
| 345 (data integrity) | Cache poisoning via incomplete `Vary`, message authenticity in IPC, signed-state bypass. |
| 400 (uncontrolled resource) | Unbounded loops driven by request, large allocations from request, recursive parsers. |
| 754 (improper exceptional check) | Catch-all error handlers that suppress security-relevant throws, validators that fail-open on parse error. |

For your target: skip CWEs that genuinely don't apply (e.g., 89 in a target with no DB layer). For the remaining CWEs, you should be able to name at least one code location per CWE that warrants probing. If you can't, you don't know the codebase yet — go back to technique 1.

## Technique 6 — Parser / serializer differential

For each concept the target normalizes more than once (URL, header, pathname, body framing, host, content-type), enumerate every implementation. The pairs are the surface.

Pairs to feed an LLM with Prompt P2 from `llm-leverage-passes.md`:

| Concept | Typical parser plurality |
|---|---|
| URL | router URL parser, fetch URL parser, image-pattern matcher, redirect destination builder |
| Header | edge runtime header parser, node server parser, middleware injector |
| Pathname | request normalizer, route matcher, file resolver, cache key |
| HTTP body framing | reverse proxy reader, framework reader, cache layer reader |
| Host | trust-proxy resolver, allowlist matcher, redirect host validator |

Yield: HRS, SSRF, route-confusion, header trust, post-redirect bypass.

## Technique 7 — Adversarial slice farm at scale

Convert the candidate matrix into parallel slices, each ≤100 LOC plus a one-sentence contract. Dispatch via `codex-rescue` with adversarial framing (Prompt P4 in `llm-leverage-passes.md`), 8 concurrent maximum.

Anti-pattern: running this technique before techniques 2 and 6. Slicing without leverage burns budget on enumeration.

## Technique 8 — Blind dual-LLM verification

Two independent sessions on every candidate before Phase G:

- Session A: adversarial framing, "prove vulnerable".
- Session B: defensive framing, "argue why safe".

Disagreement is data, not noise. Both sessions confirming = strong signal. Both sessions denying = kill the candidate.

False-positive kill rate in recent engagements: ~60%. Worth the extra session even when the first verdict feels strong.

## Technique 9 — Cross-framework pattern transfer

Every primitive confirmed in target T1 is a 30-minute probe against framework siblings. Document any sibling that exposes the same root cause; multi-project reports earn higher payout on programs that publish that bonus (Vercel OSS +50% as of 2026).

Anchor pairings to use as defaults: Next.js ↔ Nuxt; SvelteKit ↔ Astro; SolidStart ↔ Remix; Django ↔ Flask; Express ↔ Fastify; Rails ↔ Sinatra.

## Technique 10 — Compact-survival handoff doc

Before context compaction or session pause, write `HANDOFF.md` (≤30 lines) at the worktree root. Required fields, schema, and anti-patterns: see `llm-leverage-passes.md` Technique 10.

Rationale: long sessions compress automatically; the compression keeps the conversation thread but drops file:line specifics that a fresh session needs to re-enter productively. A short on-disk note survives compaction because it lives outside the model's context window.

If you cannot summarize the session in 30 lines, the slice discipline failed earlier — refactor the matrix into smaller artifacts, not a longer handoff.

## Diversity gate (anti-anchoring)

Apply this AFTER you have your candidate list. Reject the list if any of:

- One CWE class >50% of P1 candidates.
- All P1 candidates touch the same file.
- All P1 candidates use the same input channel (e.g., all from one HTTP header).
- No candidate from a non-runtime boundary (build, IPC, plugin, config).
- Fewer than 5 of techniques 1-9 actually applied to produce the list.
- Zero convergence signal: no root primitive appears across ≥2 different
  techniques' priority outputs. Convergence is the difference between
  random enumeration and structural finding. If nothing converges, the
  techniques were applied in parallel but not in dialogue — re-run with
  cross-reference between outputs.

If you fail the gate, force-add candidates from the underrepresented dimensions. The friction of "I don't have a good candidate for this CWE/boundary" is the signal that you need to read more code.

## Single Active Artifact rule (anti-bloat)

While running this expansion, never load two prior threat-model docs into
the same prompt or agent context. Each technique consumes one input:
either the current state from `HANDOFF.md`, or a single prior doc paragraph
copied in for a specific fact. The output of each technique is its own
short doc with a "Pass N+1 input" section that hands forward only the
priority candidates, not the whole reasoning trace.

Stacking docs feels thorough. It produces lower yield because the model
spends attention budget re-reading prior context instead of reasoning
about the current concept. The discipline is brutal: one artifact in,
one artifact out, the rest stays on disk.

## When to stop expanding

The threat model expansion is done when:

1. The boundary inventory is complete (every applicable row has at least one candidate).
2. The CWE matrix is complete (every applicable CWE has at least one candidate).
3. The fix lineage is read end-to-end and adjacent untouched code is in the candidate list.
4. The diversity gate passes (no class dominates).

If the hunt itself produces zero confirmed exploits across 2 rounds, return here and re-run techniques 3-5 with the data you learned. Often the second pass reveals a boundary you initially marked N/A.

## Templates

### `<date>-<target>-invariants.md` skeleton

```markdown
# <Target> Invariants

## Invariant 1 — <one-line claim>

**Claim**: <one sentence the framework asserts as true about input safety>

**Code that enforces it**: <file:line>

**Residual doubt**: <one paragraph — what could violate the claim>

**Maps to candidate(s)**: <list of candidate IDs from hunt matrix>

## Invariant 2 — ...
```

### `<date>-<target>-hunt-matrix.md` skeleton

```markdown
# <Target> Hunt Matrix

## Candidate N — <title>

**Priority**: P1 | P2 | P3
**Class**: <CWE-XXX or short class name>
**Boundary**: <which row of the boundary inventory>
**Files**: <file:line>

**Hypothesis**: <one paragraph — exact code-level reasoning>

**Probe shape**: <one paragraph — what request/input + what observed signal proves it>

**Reportable if**: <one sentence — condition for VRP/CVE-grade>
```

### Diversity report

After enumeration, write at the bottom of hunt-matrix.md:

```markdown
## Diversity report

P1 distribution:
- CWE-918 (SSRF): N candidates
- CWE-22 (path): N candidates
- CWE-345 (cache poison): N candidates
- ...

Boundary distribution:
- HTTP input: N
- Output to client: N
- Build → runtime: N
- IPC: N
- ...

Diversity gate: PASS | FAIL (if FAIL, list missing dimensions)
```

The diversity report is the single most useful artifact when handing this off to an LLM agent. It short-circuits the agent's tendency to deep-dive one class.

## Anti-patterns to refuse

- "All headers" as a single boundary entry. List each header separately or do not enumerate at all.
- Candidates without `file:line`. Refuse to add them.
- Candidates whose hypothesis is a paraphrase of "what if it's broken". Refuse — every hypothesis must reference a concrete code path or parser quirk.
- Reusing a hypothesis from a prior round verbatim. The hunt loop generates new hypotheses; if you can't, the surface is exhausted for this target.
- Enumeration that does not distinguish layer 1/2/3 of API surface. Layer 3 has the most yield and is the most often skipped.

## Hand-off to the hunting agent

The threat-model artifacts are reference material for the human orchestrator. Do **not** dump them into a single agent prompt. The agent gets one slice per probe; the orchestrator owns the full matrix.

### Slice handoff (per probe)

Pass to the hunting agent exactly:

1. **The candidate row** (one entry from the hunt matrix — hypothesis, probe shape, reportable-if).
2. **The cited slice** (≤ 200 lines around `file:line`, copied inline in the prompt — not a path the agent has to load).
3. **The contract sentence** the candidate violates (one sentence from the invariants doc, copied inline).
4. **The known-good comparator if one exists** (sibling file/function the agent should diff against).
5. **A short "already filed" list** (3-5 bullets, just enough for the agent not to rediscover).

Total prompt ≤ 3 KB of project text. If you exceed this, you are running a research task, not a probe. Split the candidate.

### Adversarial framing (replace audit framing)

| Audit framing (avoid) | Adversarial framing (use) |
|---|---|
| "Review this function for security issues." | "This function at `file:line` has a class-X bug. Demonstrate it with an end-to-end exploit." |
| "Is this implementation safe?" | "How would you break this in 50 lines of attacker code?" |
| "Audit the parser." | "Find one input that parses differently here than in `<sibling>`. Output the input." |
| "Check for prototype pollution." | "Build the manifest object that pollutes `Object.prototype.X` through this entry point." |

The pattern: assert the bug, request an exploit, name the comparator. Asking the agent to opine on safety produces rationalization; asking for an exploit produces either an exploit or a refutation, both useful.

### Slice rotation between rounds

Each closed candidate's slice doc is archived under `docs/threat-models/_archive/`. The next round opens a new slice doc with one candidate. **Never** extend the previous slice doc to add a new candidate — that is the path to 30 KB documents and context rot.

The invariants doc and fix-lineage doc grow monotonically (new invariants appear as you read more code). The hunt matrix is a living index. Slice docs are ephemeral, one per probe.

### Anchoring detection (re-run when triggered)

If Phase D produces candidates that are >50% one CWE / one channel / one file, you anchored on prior CVEs. Symptoms:

- All P1 candidates use the same input source (e.g., HTTP request headers).
- All filed findings to date share one CWE class.
- Re-running Phase D on a different boundary feels artificial.

Cure: re-enter Phase E (entry-point expansion) and force-add candidates from boundaries with zero entries in the existing matrix. Use the boundary inventory table — every row with zero candidates becomes mandatory next round.

### Context budget

If your matrix takes 30 minutes to build and each probe takes 30-60 minutes, the threat-model expansion is the highest-leverage hour. Spend it. But the second-highest-leverage discipline is keeping the per-probe prompt small. A 3 KB focused prompt outperforms a 30 KB comprehensive prompt across every modern LLM.
