# Foundation Rebuild Design

## Goal

Reset the current `vulnhunter` repository on a new branch so the project can be reconstructed from a clean foundation instead of evolving the existing orchestration system.

This rebuild is intentionally structural, not functional. The output of this phase is a small, clean repository layout with fresh documentation and no active orchestration, automation, findings, state, or proof-of-concept workflow preserved from the current system.

## Scope

This design covers only the repository reset and baseline structure.

Included:
- Create a safety branch that preserves the current dirty workspace state.
- Create a new rebuild branch for destructive cleanup.
- Remove the existing orchestration system and generated research artifacts from the rebuild branch.
- Reintroduce a minimal repository structure and documentation baseline.

Excluded:
- Rebuilding the orchestrator.
- Rebuilding agents or prompts.
- Rebuilding PoC generation or validation workflows.
- Preserving compatibility with the current `run.sh`-driven architecture.

## Branch Strategy

The reset will use two new branches:

- `archive/pre-rebuild-2026-04-22`
  - Purpose: preserve the current repository state, including the uncommitted local modifications that exist at the moment the rebuild starts.
  - This branch acts as the rollback point and historical snapshot for the old system.

- `rebuild/foundation`
  - Purpose: become the clean branch where the repository is reduced to a minimal baseline.
  - All destructive cleanup happens here.

This approach preserves the old system without forcing the new branch to keep any of its structure or conventions.

## Cleanup Boundary

The rebuild branch will remove the current operational system rather than trying to adapt it.

The cleanup target includes:
- Existing orchestration entrypoints such as `run.sh`.
- Old repository instructions and prompt scaffolding that are tightly coupled to the current workflow.
- Existing agent definitions under `.claude/agents/`.
- Generated research state and results such as `state/`, `bugs/`, `archive/`, `builds/`, and similar workflow artifacts.
- Legacy architecture and process documents that describe the old system rather than the new foundation.

The cleanup will not rewrite git history. It only changes the visible contents of the new rebuild branch.

## Minimal Baseline After Reset

After cleanup, the rebuild branch should contain only a minimal structure that supports future design work:

- `README.md`
  - Fresh project description.
  - Explicit statement that the repository is in foundation-rebuild mode.
  - Core principles for the new direction: small scope, explicit workflows, minimal context, and no premature automation.

- `docs/architecture.md`
  - Minimal architecture note describing the repository as a clean foundation rather than an implemented platform.
  - No promises about orchestrators, agents, or autonomous pipelines that do not yet exist.

- `docs/rebuild/2026-04-22-foundation-design.md`
  - Human-readable record of the reset intent and structural choices.

- `cases/.gitkeep`
  - Placeholder for future isolated cases, PoCs, or findings.

- `.gitignore`
  - Reset to a minimal, future-facing baseline suitable for research artifacts that may be introduced later, without carrying forward old workflow assumptions.

No executable orchestration should remain after this phase.

## Repository Philosophy After Reset

The rebuilt repository should communicate a different posture from the current one:

- The repo is a workspace for deliberate reconstruction.
- Documentation defines intent before automation exists.
- Future workflows should start as narrow, testable, single-case flows before expanding into multi-agent orchestration.
- The repository should avoid embedding large, brittle instruction surfaces until there is a proven need for them.

This is intentionally aligned with the decision to remove old orchestration first and defer all new orchestration design until after the foundation is stable.

## Operational Sequence

The implementation should follow this order:

1. Confirm the current working tree state.
2. Create `archive/pre-rebuild-2026-04-22`.
3. Commit the current repository state to that archive branch.
4. Create `rebuild/foundation`.
5. Perform destructive cleanup only on `rebuild/foundation`.
6. Add the minimal baseline files and directories.
7. Commit the foundation reset as a separate commit on `rebuild/foundation`.

The separation between the archive snapshot and the rebuild commit is important. It keeps the recovery path simple and makes the rebuild branch easy to reason about.

## Risks And Mitigations

### Risk: Accidental loss of current local work

Mitigation:
- Snapshot the current dirty workspace into `archive/pre-rebuild-2026-04-22` before cleanup.

### Risk: The rebuild branch still carries semantic baggage from the old system

Mitigation:
- Remove old orchestration files entirely instead of editing them down.
- Recreate only a tiny set of baseline files from scratch.

### Risk: The repository looks "empty" after reset

Mitigation:
- Keep high-signal documentation explaining the purpose of the reset and the next intended phase.

## Success Criteria

This rebuild phase is successful if all of the following are true:

- A branch exists that preserves the old system state.
- `rebuild/foundation` exists and contains no active legacy orchestration system.
- The rebuild branch has a small, coherent repository structure.
- The repository documentation describes only what currently exists.
- The repository is ready for a future design pass on a new, smaller orchestration model.

## Non-Goals

This phase will not:
- Deliver a working PoC pipeline.
- Deliver a working orchestrator.
- Preserve backwards compatibility with the current repository layout.
- Attempt to cleanly migrate old findings into the new structure.

The correct outcome is a clean starting point, not a transitional compatibility layer.
