# VulnHunter v2

**Fully autonomous vulnerability hunter.** Claude orquesta, Codex hace TODO.

- Static + Dynamic analysis
- No timeout — runs until complete
- No human interaction required
- Checkpoints for long-running analysis
- **5-Gate validation pipeline** (including mandatory real library testing)

## CRITICAL REQUIREMENT

```
╔═══════════════════════════════════════════════════════════════════════════╗
║  ALL FINDINGS MUST BE TESTED AGAINST THE REAL COMPILED LIBRARY            ║
║                                                                           ║
║  - Simulations are NOT sufficient                                         ║
║  - Theoretical analysis is NOT sufficient                                 ║
║  - Python wrappers may not reflect C++ behavior                           ║
║  - You MUST compile and run a PoC against the actual library              ║
╚═══════════════════════════════════════════════════════════════════════════╝
```

This is enforced by **Gate 5** in the validation pipeline.

## Quick Start

```bash
# Start autonomous analysis (runs in background)
./run.sh --provider google --target app.js --background

# Check progress
./run.sh --status

# View findings in real-time
./run.sh --findings

# Stop and save checkpoint
./run.sh --stop
```

## Architecture

```
Claude (orchestrator)
    │
    └─> ./run.sh --background
            │
            ├─> Phase 1: Discovery (static + dynamic recon)
            │   └─> Codex: maps attack surface, enumerates endpoints
            │
            ├─> Phase 2: Deep Dive (exploitation testing)
            │   └─> Codex: writes PoCs, tests exploits, runs tools
            │
            ├─> Phase 3: Validation (CVSS, scope check)
            │   └─> Codex: confirms findings, scores, ranks
            │
            └─> Phase 4: Report (submission-ready)
                └─> Codex: generates Google VRP reports

            [Runs indefinitely until complete]
            [Checkpoints saved every 5 minutes]
            [Findings logged in real-time]
```

## Features

| Feature | Description |
|---------|-------------|
| **No timeout** | Codex runs as long as needed |
| **Dynamic testing** | Executes curl, nmap, sqlmap, ffuf, etc. |
| **Full autonomy** | No human interaction until complete |
| **Checkpoints** | Progress saved, can resume if interrupted |
| **Real-time findings** | Discoveries logged immediately |
| **Background mode** | Runs as daemon, check status anytime |

## Usage

### Full Autonomous Run

```bash
# Start and detach
./run.sh --provider google --target samples/vulnerable_web_app.js --background

# Monitor
./run.sh --status
tail -f logs/vulnhunter_*.log

# When done, review
cat reports/google_analysis_*.txt
```

### Commands

| Command | Description |
|---------|-------------|
| `--background` | Run as daemon (returns immediately) |
| `--status` | Show current phase, runtime, findings count |
| `--findings` | Display all findings discovered so far |
| `--stop` | Gracefully stop (checkpoint saved) |
| `--help` | Show all options |

### Single Phase

```bash
./run.sh --provider google --target app.js --phase discovery
./run.sh --provider google --phase deep-dive      # resumes thread
./run.sh --provider google --phase validation
./run.sh --provider google --phase report
```

## Phases

### 1. Discovery
- Static code analysis
- Dynamic endpoint enumeration
- Technology fingerprinting
- Identifies top-10 attack vectors

### 2. Deep Dive
- Root cause analysis
- Writes working exploits
- **Executes dynamic tests** (curl, tools)
- Documents exact reproduction steps

### 3. Validation
- Re-tests all findings
- CVSS v3.1 scoring
- Google VRP scope verification
- Ranks by impact and submittability

### 4. Report
- Generates submission-ready reports
- Copy-paste format for bughunters.google.com
- Includes PoC code and steps

## Project Structure

```
vulnhunter/
├── README.md                              # This file
├── run.sh                                 # Main orchestrator script
│
├── bugs/                                  # Organized by vulnerability
│   └── <bug-name>/
│       ├── README.md                      # Bug summary
│       ├── poc/                           # Proof of Concept
│       │   ├── poc_source.cpp
│       │   └── poc_binary                 # REQUIRED: Compiled PoC
│       ├── analysis/                      # Investigation docs
│       ├── debugging/                     # LLDB/GDB sessions
│       └── report/                        # VRP submission docs
│
├── docs/                                  # General guides
│   ├── DEBUGGING_QUICK_REFERENCE.md
│   └── AUTONOMOUS_VALIDATION_GUIDE.md
│
├── validation/
│   └── validation-pipeline.sh             # 5-gate validation
│
├── reports/                               # Generated reports
├── findings/                              # Real-time findings
├── logs/                                  # Execution logs
└── .checkpoints/                          # Resume data
```

## Validation Pipeline (5 Gates)

| Gate | Name | Description |
|------|------|-------------|
| 1 | Rejection Filters | Auto-reject documented/intentional behaviors |
| 2 | Documentation Search | Check for contradictions in official docs |
| 3 | CVSS Validation | Verify scores aren't inflated |
| 4 | Independent Review | Second opinion from code-reviewer agent |
| 5 | **Real Library Test** | **MANDATORY: PoC must crash real library** |

Gate 5 is **non-negotiable**. Without a compiled PoC tested against the real library, the validation pipeline will fail.

## What Codex Can Do

Codex has **full permissions**:
- Execute shell commands
- Run security tools (nmap, sqlmap, ffuf, nuclei, etc.)
- Write and execute scripts
- Make HTTP requests
- Install tools if needed

## Example Session

```bash
$ ./run.sh --provider google --target api.js --background
[VulnHunter] Started autonomous analysis
[VulnHunter] PID: 12345
[VulnHunter] Log: logs/vulnhunter_20260412_120000.log

$ ./run.sh --status
[VulnHunter] RUNNING (PID: 12345)
[VulnHunter] Phase: deep_dive
[VulnHunter] Started: 2026-04-12 12:00:00
[VulnHunter] Runtime: 2h 15m
[VulnHunter] Findings so far: 3

[Latest activity]
[2026-04-12 14:15:22] [FINDING] [HIGH] SSRF in /api/fetch endpoint
[2026-04-12 14:15:23] [INFO] Testing additional SSRF payloads...

$ ./run.sh --findings
[FINDING] CRITICAL: RCE via deserialization in /api/import
[FINDING] HIGH: SSRF to internal metadata in /api/fetch
[FINDING] MEDIUM: Stored XSS in comment field

$ # Wait for completion, then...
$ cat reports/google_analysis_20260412_120000.txt
```

## Requirements

- Bash shell
- Node.js
- Codex CLI (Azure OpenAI configured)
- Optional: nmap, sqlmap, ffuf, nuclei (Codex can install)

## Notes

- Analysis can take **hours or days** depending on target complexity
- Codex will be thorough — it tests everything
- Findings are logged immediately, report generated at end
- Use `--stop` to gracefully interrupt (checkpoint saved)
- Resume with `--phase <next-phase>` after stopping
