# VulnHunter v4 - Claude Orchestrator Architecture

## Design Principle

Claude is the BRAIN. Agents are HANDS. Each agent does ONE thing.
Claude decides timing, parallelism, retries, and consensus.

## 7 Agents

```
┌─────────────────────────────────────────────────────────────┐
│  CLAUDE ORCHESTRATOR                                         │
│  - Decides which agents to launch                           │
│  - Launches parallel when possible                          │
│  - Compares results (consensus logic is HERE)               │
│  - Manages hunt loop state                                  │
│  - Tracks primitives catalog                                │
│  - Decides what to report based on CIA impact               │
└─────┬───────┬───────┬───────┬───────┬───────┬───────┬───────┘
      │       │       │       │       │       │       │
      ▼       ▼       ▼       ▼       ▼       ▼       ▼
   build  codeql  discovery  asan    lldb   chain  reporter
```

| # | Agent | What it does | Parallelizable |
|---|-------|-------------|----------------|
| 1 | build-agent | Compiles target with ASan + debug flags | Background |
| 2 | codeql-discovery | Semantic analysis + adaptive learning | No (setup) |
| 3 | discovery | Reasons about code, finds issues | No (needs full context) |
| 4 | asan-validator | Compiles PoC with ASan, runs, captures crash | Yes (per finding) |
| 5 | lldb-debugger | Compiles PoC WITHOUT ASan, inspects state | Yes (per finding, blind) |
| 6 | chain-researcher | Escalation + primitives + leads + CVSS | Yes (per finding) |
| 7 | reporter | VRP report + explainer (1 agent, both outputs) | Background |

## What Claude Does (NOT agents)

- **Consensus:** Compare ASan + LLDB sealed results. No agent needed.
- **Context management:** Claude tracks state natively. No agent needed.
- **Impact assessment:** Part of chain-researcher output. No separate agent.
- **PoC creation:** Validators create their own PoCs. No separate agent.
- **Feedback protocol:** Format defined in agent docs. No separate agent.

## Workflow

```
SETUP (once):
  1. build-agent (background) → wait for completion
  2. codeql-discovery → semantic findings (skip if C++ large target)

HUNT LOOP:
  ┌─────────────────────────────────────────────────────────────┐
  │                                                             │
  │  3. discovery → findings[]                                  │
  │     Cycle 1: full codebase scan                            │
  │     Cycle 2+: focused on new_leads from chain              │
  │                                                             │
  │  4. VALIDATION (parallel per finding, Claude compares):     │
  │     For each finding:                                       │
  │       Agent(asan-validator, finding)  ──┐                   │
  │       Agent(lldb-debugger, finding)   ──┤ parallel, blind   │
  │                                         │                   │
  │       Claude waits for both, compares:  │                   │
  │       ├─ Both BUG → confirmed           │                   │
  │       ├─ Disagree → investigate         │                   │
  │       └─ Both OK → dismissed            │                   │
  │                                                             │
  │  5. reporter (background) for each confirmed finding        │
  │     Non-blocking, reports while hunt continues              │
  │                                                             │
  │  6. chain-researcher per confirmed finding:                 │
  │     - Escalation paths (DoS → integrity?)                  │
  │     - Primitives catalog                                    │
  │     - CVSS calculation                                      │
  │     - new_leads[] for next cycle                           │
  │     - CodeQL learning feedback                             │
  │                                                             │
  │  EXIT CHECK:                                                │
  │     Claude counts dry_cycles.                               │
  │     New confirmation → reset to 0.                          │
  │     dry_cycles >= 6 → exit loop.                           │
  │     new_leads? → back to discovery.                        │
  │                                                             │
  └─────────────────────────────────────────────────────────────┘

POST-LOOP:
  7. Wait for background reporters to finish
  8. Final summary with all findings, chains, primitives
```

## Agent Communication

No inter-agent communication. Claude mediates everything.

```
discovery output    → Claude reads → passes to validators
asan output         → Claude reads → compares with lldb
lldb output         → Claude reads → compares with asan
chain output        → Claude reads → feeds back to discovery
reporter output     → Claude reads → presents to user
```

## Parallel Execution Map

```
Phase     | What runs                    | Parallel?
----------|------------------------------|----------
Setup     | build-agent                  | Background
Setup     | codeql-discovery             | After build
Discovery | discovery                    | Sequential
Validate  | asan(f1) + lldb(f1)         | Parallel (blind)
          | asan(f2) + lldb(f2)         | Parallel (blind)
          | asan(f3) + lldb(f3)         | Parallel (blind)
Report    | reporter(f1), reporter(f2)   | Background
Chain     | chain(f1), chain(f2)         | Parallel per finding
```

Max parallelism in validation:
- 3 findings × 2 validators = 6 agents at once

## Agent Output Format (standard)

Every agent returns JSON:

```json
{
    "agent": "agent-name",
    "finding_id": "finding-001",
    "status": "CONFIRMED|REJECTED|NEEDS_BUILD|INCONCLUSIVE",
    "evidence": { ... },
    "notes": "human-readable summary"
}
```

Claude reads this and decides next action.

## NEEDS_DIFFERENT_BUILD Flow

```
asan-validator returns:
  {"status": "NEEDS_BUILD", "build_request": {"target": "objc", ...}}

Claude:
  1. Launches build-agent with specific target
  2. Waits for build
  3. Re-launches asan-validator with new build
  4. Re-launches lldb-debugger with new build
```

## Primitives & Chain Philosophy

```
Every finding = primitive, even if DoS-only.
Chain-researcher tries to combine primitives.
Claude tracks primitives_catalog across all cycles.
Only report if chain achieves integrity/confidentiality.
```
