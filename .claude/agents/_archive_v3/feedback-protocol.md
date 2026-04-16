---
name: feedback-protocol
description: Standard format for inter-agent feedback that enables learning
---

# Inter-Agent Feedback Protocol

## Purpose

Agents need to communicate results back to enable learning.
This protocol defines the standard format.

## Feedback Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    FEEDBACK LOOP                                 │
│                                                                  │
│   PHASE 0.5          PHASE 2           PHASE 2.5                │
│   ┌────────┐        ┌────────┐        ┌────────┐                │
│   │ CodeQL │──────► │Validate│──────► │ Learn  │                │
│   └────────┘        └────────┘        └────────┘                │
│       │                  │                 │                     │
│       │   findings.json  │ feedback.json   │                     │
│       └──────────────────┴─────────────────┘                     │
│                          │                                       │
│                          ▼                                       │
│                   ┌────────────┐                                 │
│                   │  NEXT RUN  │ (improved queries)              │
│                   └────────────┘                                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## File Locations

```
state/
├── current_run/
│   ├── codeql_findings.json      # From CodeQL agent
│   ├── validation_feedback.json  # From validators
│   └── learning_report.json      # From learning phase
```

## Format: CodeQL Findings

```json
// state/current_run/codeql_findings.json
{
    "run_id": "20240115_143022",
    "target": "protobuf",
    "findings": [
        {
            "id": "cql-001",
            "query": "recursion_unbounded_v2.ql",
            "query_version": 2,
            "rule_id": "custom/unbounded-recursion",
            "file": "src/text_format.cc",
            "line": 3159,
            "function": "PrintUnknownFields",
            "message": "Recursive function without depth check",
            "confidence": 0.75,
            "dataflow": [
                {"step": 1, "file": "text_format.cc", "line": 3100, "action": "entry"},
                {"step": 2, "file": "text_format.cc", "line": 3159, "action": "recursive call"}
            ],
            "metadata": {
                "query_precision": 0.67,
                "similar_to_confirmed": true,
                "hot_spot_file": true
            }
        }
    ]
}
```

## Format: Validation Feedback

```json
// state/current_run/validation_feedback.json
{
    "run_id": "20240115_143022",
    "validator": "asan-validator",
    "timestamp": "2024-01-15T14:45:00Z",
    "results": [
        {
            "finding_id": "cql-001",
            "status": "CONFIRMED",
            "evidence": {
                "type": "asan_crash",
                "crash_type": "stack-overflow",
                "crash_location": "text_format.cc:3159",
                "stack_depth": 35000,
                "asan_output_file": "asan_output_001.txt"
            },
            "notes": "Confirmed stack overflow at depth 35000"
        },
        {
            "finding_id": "cql-002",
            "status": "FALSE_POSITIVE",
            "reason": "bounds_check_exists",
            "evidence": {
                "type": "code_analysis",
                "check_location": "parser.cc:142",
                "check_type": "if (size < MAX_SIZE)"
            },
            "notes": "Size is validated before use"
        },
        {
            "finding_id": "cql-003",
            "status": "NEEDS_INVESTIGATION",
            "reason": "no_crash_but_suspicious",
            "notes": "No ASan crash but logic looks wrong"
        }
    ]
}
```

## Format: Learning Report

```json
// state/current_run/learning_report.json
{
    "run_id": "20240115_143022",
    "target": "protobuf",
    "timestamp": "2024-01-15T15:00:00Z",
    "summary": {
        "findings_processed": 10,
        "confirmed": 3,
        "false_positives": 5,
        "needs_investigation": 2
    },
    "actions_taken": [
        {
            "action": "query_mutation",
            "query": "buffer_overflow_v1.ql",
            "old_version": 1,
            "new_version": 2,
            "change": "Added exclusion: preceded by bounds check",
            "reason": "5 false positives had bounds checks"
        },
        {
            "action": "pattern_saved",
            "pattern_id": "recursion-no-depth-check",
            "source_finding": "cql-001",
            "description": "Recursive function without depth parameter"
        },
        {
            "action": "query_generated",
            "new_query": "recursion_nested_groups.ql",
            "derived_from": "cql-001",
            "description": "Specific pattern for nested group recursion"
        },
        {
            "action": "query_retired",
            "query": "format_string_basic.ql",
            "reason": "precision < 0.1 after 10 runs"
        }
    ],
    "metrics_update": {
        "overall_precision_before": 0.35,
        "overall_precision_after": 0.42,
        "queries_improved": 2,
        "queries_retired": 1,
        "patterns_learned": 1
    }
}
```

## Validator Output Requirements

**ALL validators MUST output feedback in standard format:**

```bash
# At end of validation, save feedback
cat > state/current_run/validation_feedback.json << 'EOF'
{
    "validator": "asan-validator",
    "results": [
        {
            "finding_id": "...",
            "status": "CONFIRMED|FALSE_POSITIVE|NEEDS_INVESTIGATION",
            ...
        }
    ]
}
EOF
```

## Orchestrator Responsibilities

After PHASE 2 (Validation):

```python
def trigger_learning():
    # 1. Collect all feedback files
    codeql_findings = read("state/current_run/codeql_findings.json")
    validation_feedback = read("state/current_run/validation_feedback.json")
    
    # 2. Launch learning phase
    Agent(
        subagent_type="codex:codex-rescue",
        prompt=f"""
        You are the CodeQL Learning Agent.
        
        Process this validation feedback and update the learning system:
        
        FINDINGS: {codeql_findings}
        FEEDBACK: {validation_feedback}
        
        For each finding:
        - CONFIRMED: learn_success() - extract pattern, update metrics
        - FALSE_POSITIVE: learn_failure() - mutate query, add exclusion
        
        Update files in learned/ directory.
        Output learning_report.json when done.
        """
    )
    
    # 3. Wait for learning to complete
    # 4. Next target will use improved queries
```

## Status Values

| Status | Meaning | Learning Action |
|--------|---------|-----------------|
| `CONFIRMED` | Validator proved bug exists | Save pattern, increase query precision |
| `FALSE_POSITIVE` | Not a real bug | Mutate query with exclusion |
| `NEEDS_INVESTIGATION` | Unclear, needs manual review | Flag for human review |
| `DUPLICATE` | Same as another finding | Merge, don't double-count |
| `OUT_OF_SCOPE` | Valid bug but not in scope | Note but don't learn |

## Cross-Agent Communication

```
┌──────────────┐     findings.json      ┌──────────────┐
│    CodeQL    │ ─────────────────────► │  Validators  │
│   Discovery  │                        │ (ASan, LLDB) │
└──────────────┘                        └──────┬───────┘
       ▲                                       │
       │                               feedback.json
       │                                       │
       │         ┌──────────────┐              │
       └─────────│   Learning   │◄─────────────┘
                 │    Agent     │
                 └──────────────┘
                        │
                        ▼
                 learned/*.json
                 (improved for next run)
```
