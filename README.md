# VulnHunter v3

**Autonomous vulnerability hunter with multi-agent orchestration.**

Two execution modes:
- **run.sh**: Bash script, Codex direct, no Claude tokens
- **Claude Orchestrator**: `/vulnhunt` skill, intelligent decisions, infinite retry

## Quick Start

### Option 1: run.sh (economical)

```bash
# Start autonomous analysis
./run.sh --provider openai --target ./targets/protobuf --no-sandbox --fresh --background

# Monitor
./run.sh --target ./targets/protobuf --status
./run.sh --target ./targets/protobuf --findings

# Stop
./run.sh --target ./targets/protobuf --stop
```

### Option 2: Claude Orchestrator (intelligent)

```
/vulnhunt target=./targets/protobuf depth=deep focus=memory
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         VulnHunter v3                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐     ┌──────────────────────────────────────┐  │
│  │   run.sh     │     │       Claude Orchestrator            │  │
│  │  (bash)      │     │         (/vulnhunt)                  │  │
│  └──────┬───────┘     └──────────────┬───────────────────────┘  │
│         │                            │                           │
│         │                            ▼                           │
│         │             ┌──────────────────────────────────────┐  │
│         │             │        Agent Templates               │  │
│         │             │  discovery | asan-validator | lldb   │  │
│         │             │  chain-researcher | vrp-reporter     │  │
│         │             └──────────────────────────────────────┘  │
│         │                            │                           │
│         ▼                            ▼                           │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Codex (GPT-5.4)                        │   │
│  │              Pattern scanning, PoC creation,              │   │
│  │              Validation, Chain research                   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                            │                                     │
│                            ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                 Validation Pipeline                       │   │
│  │     Gate 1-4: Filters | Gate 5: REAL LIBRARY TEST        │   │
│  └──────────────────────────────────────────────────────────┘   │
│                            │                                     │
│                            ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    bugs/<name>/                           │   │
│  │         poc/ | debugging/ | analysis/ | report/           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Critical Requirements

```
╔═══════════════════════════════════════════════════════════════════════════╗
║  ALL FINDINGS MUST BE TESTED AGAINST THE REAL COMPILED LIBRARY            ║
║                                                                           ║
║  - Simulations are NOT sufficient                                         ║
║  - Theoretical analysis is NOT sufficient                                 ║
║  - You MUST compile and run a PoC against the actual library              ║
╚═══════════════════════════════════════════════════════════════════════════╝
```

## Key Features

| Feature | run.sh | Claude Orchestrator |
|---------|--------|---------------------|
| Claude tokens | 0 | Yes |
| Infinite retry | Yes (100 refusals) | Yes (100 refusals) |
| Intelligent decisions | No | Yes |
| Parallelization | Basic | Smart |
| Chain research | No | Yes (with web search) |
| Prompt reformulation | Fixed | Dynamic |

## Documentation

- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** - Complete system documentation
- **[CLAUDE.md](CLAUDE.md)** - Claude orchestrator instructions
- **[.claude/skills/vulnhunt/SKILL.md](.claude/skills/vulnhunt/SKILL.md)** - /vulnhunt skill with retry logic

## Agents

| Agent | Purpose |
|-------|---------|
| discovery | Find potential vulnerabilities |
| poc-builder | Create quick test harnesses |
| asan-validator | Validate against REAL compiled library |
| lldb-debugger | Generate step-by-step memory evidence |
| chain-researcher | Find exploit chains (with web search) |
| impact-analyst | Calculate CVSS scores |
| vrp-reporter | Technical Google VRP report |
| explainer-reporter | Non-technical explanation |

## Output Structure

```
bugs/<bug-name>/
├── poc/
│   ├── poc_real.cpp        # PoC against compiled library
│   └── asan_output.txt     # ASan crash evidence
├── debugging/
│   └── LLDB_DEBUG_REPORT.md
├── analysis/
│   └── CHAIN_RESEARCH.md
└── report/
    ├── GOOGLE_VRP_REPORT.md
    └── GOOGLE_VRP_QUICK_SUBMIT.md
```

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 3.0 | 2026-04-14 | Multi-agent architecture, Claude orchestrator, infinite retry |
| 2.0 | 2026-04-12 | Validation pipeline, checkpoints |
| 1.0 | 2026-04-10 | Initial release |
