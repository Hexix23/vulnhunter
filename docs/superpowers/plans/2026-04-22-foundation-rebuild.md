# Foundation Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Snapshot the current repository state, create a new rebuild branch, remove the legacy orchestration system, and leave a minimal documentation-first foundation.

**Architecture:** The reset happens in two stages. First, preserve the current dirty workspace on an archive branch so nothing is lost. Second, create a rebuild branch, delete the legacy runtime/orchestration tree, and replace it with a tiny baseline: fresh root docs, a minimal `cases/` placeholder, and a simplified `.gitignore`.

**Tech Stack:** Git, shell commands, Markdown documentation, existing repository workspace.

---

### Task 1: Snapshot The Current Workspace On An Archive Branch

**Files:**
- Modify: `.git/` state through branch creation and commit metadata
- Preserve in archive commit: current tracked files plus current local modifications in `CLAUDE.md`, `run.sh`, `.claude/agents/orchestrator.md`, and any existing generated content

- [ ] **Step 1: Confirm the current branch and working tree**

Run:

```bash
git branch --show-current
git status --short
```

Expected:
- Current branch is `main`
- Working tree is dirty

- [ ] **Step 2: Create and switch to the archive branch**

Run:

```bash
git switch -c archive/pre-rebuild-2026-04-22
```

Expected:
- Output contains `Switched to a new branch 'archive/pre-rebuild-2026-04-22'`

- [ ] **Step 3: Stage the full repository state for the archive snapshot**

Run:

```bash
git add -A
git status --short
```

Expected:
- No unstaged changes remain
- Files show as staged with `A`, `M`, or `D`

- [ ] **Step 4: Commit the archive snapshot**

Run:

```bash
git commit -m "chore: snapshot repository before foundation rebuild"
```

Expected:
- Commit succeeds
- Working tree becomes clean on `archive/pre-rebuild-2026-04-22`

- [ ] **Step 5: Record the archive snapshot hash**

Run:

```bash
git rev-parse --short HEAD
```

Expected:
- Returns a short commit hash that can be referenced as the rollback point

### Task 2: Create The Rebuild Branch

**Files:**
- Modify: `.git/` branch references only

- [ ] **Step 1: Create and switch to the rebuild branch from the archive snapshot**

Run:

```bash
git switch -c rebuild/foundation
```

Expected:
- Output contains `Switched to a new branch 'rebuild/foundation'`

- [ ] **Step 2: Verify the rebuild branch starts clean**

Run:

```bash
git branch --show-current
git status --short
```

Expected:
- Current branch is `rebuild/foundation`
- Working tree is clean

- [ ] **Step 3: Capture the pre-cleanup top-level layout for reference**

Run:

```bash
find . -maxdepth 2 -mindepth 1 | sort
```

Expected:
- Shows the current legacy repository tree before deletion

### Task 3: Remove The Legacy System From The Rebuild Branch

**Files:**
- Delete: `CLAUDE.md`
- Delete: `run.sh`
- Delete: `validate_all_findings.sh`
- Delete: `.claude/`
- Delete: `archive/`
- Delete: `bugs/`
- Delete: `builds/`
- Delete: `learned/`
- Delete: `logs/`
- Delete: `oldsize`
- Delete: `scripts/`
- Delete: `state/`
- Delete: `targets/`
- Delete: `templates/`
- Delete: `docs/ARCHITECTURE.md`
- Delete: `docs/ARCHITECTURE_V4.md`
- Delete: `docs/AUTONOMOUS_VALIDATION_GUIDE.md`
- Delete: `docs/DEBUGGING_QUICK_REFERENCE.md`
- Delete: `.checkpoints/`
- Delete: `.codex-tmp/`
- Delete: `.pids/`
- Delete: `.DS_Store`

- [ ] **Step 1: Remove tracked legacy files and directories**

Run:

```bash
git rm -r CLAUDE.md run.sh validate_all_findings.sh .claude archive bugs builds learned logs oldsize scripts state targets templates docs/ARCHITECTURE.md docs/ARCHITECTURE_V4.md docs/AUTONOMOUS_VALIDATION_GUIDE.md docs/DEBUGGING_QUICK_REFERENCE.md
```

Expected:
- Git reports removed tracked files

- [ ] **Step 2: Remove untracked or transient legacy directories**

Run:

```bash
rm -rf .checkpoints .codex-tmp .pids
rm -f .DS_Store
```

Expected:
- Commands complete with no output or only shell confirmation

- [ ] **Step 3: Verify the repository tree is now mostly empty except for git metadata and planning docs**

Run:

```bash
find . -maxdepth 2 -mindepth 1 | sort
git status --short
```

Expected:
- Legacy runtime/orchestration directories are gone
- The main staged changes are deletions

### Task 4: Rebuild The Minimal Foundation Files

**Files:**
- Modify: `README.md`
- Modify: `.gitignore`
- Create: `docs/architecture.md`
- Create: `docs/rebuild/2026-04-22-foundation-design.md`
- Create: `cases/.gitkeep`

- [ ] **Step 1: Write the new `README.md`**

Replace `README.md` with:

```markdown
# VulnHunter

This repository is being rebuilt from a clean foundation.

The previous orchestration system, generated findings, validation state, and automation workflow have been intentionally removed from the active branch. The current branch exists to establish a small, explicit baseline before any new orchestration or proof-of-concept pipeline is introduced.

## Current State

- Documentation-first reset
- No active orchestrator
- No active agents
- No automated PoC workflow
- No persisted findings or runtime state

## Principles

- Start narrow before scaling out
- Prefer explicit workflows over hidden orchestration
- Keep context surfaces small
- Add automation only after the manual shape is clear

## Repository Layout

- `docs/architecture.md` — minimal architectural baseline
- `docs/rebuild/` — rebuild notes and reset decisions
- `cases/` — placeholder for future isolated cases

## Next Phase

The next phase is to design a minimal case-oriented workflow from scratch. That work will happen after this foundation branch is stable.
```

- [ ] **Step 2: Write the new `docs/architecture.md`**

Create `docs/architecture.md` with:

```markdown
# Architecture

## Purpose

`vulnhunter` is currently a foundation-only repository. It does not expose an execution engine, orchestrator, agent framework, or validation pipeline at this stage.

## Architectural Posture

The repository is intentionally small. It exists to support deliberate reconstruction of a future workflow rather than to preserve compatibility with the previous system.

The design assumptions for this phase are:

- single-purpose documentation is better than broad operational promises
- future workflows should begin with one isolated case at a time
- state, findings, and generated artifacts should remain outside the core repository shape until the new workflow is proven

## Current Components

- `README.md` explains the rebuild state and repository principles
- `docs/rebuild/` records rebuild intent and structural decisions
- `cases/` is an empty placeholder for future case-based work

## Not Present

The following do not currently exist in the active architecture:

- autonomous runner
- persistent validation state
- embedded prompt/agent system
- build orchestration
- multi-finding pipeline
```

- [ ] **Step 3: Write the new `docs/rebuild/2026-04-22-foundation-design.md`**

Create `docs/rebuild/2026-04-22-foundation-design.md` with:

```markdown
# Foundation Rebuild

## Date

2026-04-22

## Intent

This branch resets the repository to a minimal baseline. The old orchestration system was archived on `archive/pre-rebuild-2026-04-22`, and the active branch was reduced to a small documentation-first structure.

## What Was Removed

- legacy orchestration entrypoints
- legacy prompt and agent scaffolding
- generated findings and validation artifacts
- accumulated runtime state
- old architecture and process documentation tied to the previous system

## What Remains

- `README.md`
- `docs/architecture.md`
- this rebuild record
- `cases/`

## Why

The repository had accumulated too much workflow-specific structure to support a clean redesign. Starting from a small baseline makes it easier to define the next workflow deliberately instead of adapting the previous system.
```

- [ ] **Step 4: Write the new `.gitignore`**

Replace `.gitignore` with:

```gitignore
.DS_Store

.checkpoints/
.codex-tmp/
.pids/

*.log

cases/**/artifacts/
cases/**/build/
cases/**/tmp/

!cases/.gitkeep
```

- [ ] **Step 5: Create the `cases/` placeholder**

Run:

```bash
mkdir -p cases docs/rebuild
touch cases/.gitkeep
```

Expected:
- `cases/.gitkeep` exists
- `docs/rebuild/` exists

### Task 5: Verify And Commit The Foundation Reset

**Files:**
- Verify: `README.md`
- Verify: `.gitignore`
- Verify: `docs/architecture.md`
- Verify: `docs/rebuild/2026-04-22-foundation-design.md`
- Verify: `cases/.gitkeep`

- [ ] **Step 1: Verify the final top-level tree**

Run:

```bash
find . -maxdepth 2 -mindepth 1 | sort
```

Expected:
- Top-level output is small and centered on `README.md`, `docs/`, `cases/`, `.gitignore`, and git internals

- [ ] **Step 2: Verify the rebuilt files contain only the new baseline content**

Run:

```bash
sed -n '1,220p' README.md
printf "\n---\n"
sed -n '1,220p' docs/architecture.md
printf "\n---\n"
sed -n '1,220p' docs/rebuild/2026-04-22-foundation-design.md
printf "\n---\n"
sed -n '1,220p' .gitignore
```

Expected:
- Output matches the new minimal design
- No legacy orchestration references remain

- [ ] **Step 3: Verify the working tree contains only intentional changes**

Run:

```bash
git status --short
```

Expected:
- Only the planned deletions and baseline file additions/modifications appear

- [ ] **Step 4: Commit the rebuild foundation**

Run:

```bash
git add -A
git commit -m "chore: reset repository to foundation baseline"
```

Expected:
- Commit succeeds on `rebuild/foundation`

- [ ] **Step 5: Record the resulting branch state**

Run:

```bash
git branch --show-current
git rev-parse --short HEAD
```

Expected:
- Branch is `rebuild/foundation`
- A new commit hash is produced for the reset baseline
