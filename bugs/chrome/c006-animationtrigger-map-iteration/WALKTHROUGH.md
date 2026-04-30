# C006 AnimationTrigger Map Iteration Walkthrough

Goal: variant hunt from stable patch `1c93fde36884ca2474c0abdc5590cbcbcf1ab8dc`.

## Fixed bug fingerprint

Patch:

```diff
-  for (auto [animation, behaviors] : animation_behavior_map_) {
+  auto map_copy = animation_behavior_map_;
+  for (auto [animation, behaviors] : map_copy) {
```

Applied to:
- `AnimationTrigger::PerformActivate()`
- `AnimationTrigger::PerformDeactivate()`

Local vulnerable source still has live map iteration at:
- `third_party/blink/renderer/core/animation/animation_trigger.cc:257-278`

`PerformBehavior()` wraps animation operations in `ScriptForbiddenScope`, but the
stable fix proves that script-forbidden is not enough: animation lifecycle side
effects can still mutate `animation_behavior_map_` while the map is being
iterated.

## Source sinks

- `AnimationTrigger::PerformActivate()` calls `PerformBehavior(*animation, ...)`
  while iterating `animation_behavior_map_`.
- `AnimationTrigger::PerformDeactivate()` has the same pattern.
- `TimelineTrigger::Update()` calls `PerformActivate()` / `PerformDeactivate()`
  on trigger state changes.
- `Animation::DisassociateTriggers()` swaps `triggers_`, then calls
  `trigger->removeAnimation(this)`, which erases from `animation_behavior_map_`.
- `AnimationTrigger::removeAnimation()` has `CHECK(!is_activating_or_deactivating_)`,
  but the fixed bug copied the map instead of relying only on this guard.
- `AnimationTrigger::UpdateCompositorTriggerAnimations()` still iterates
  `animation_behavior_map_` live and calls animation methods. This is the
  primary variant sink.
- `ScrollSnapshotTimeline::UpdateSnapshotInternal()` calls `trigger->Update()`;
  if the trigger changes, it immediately iterates `trigger->BehaviorMap()` and
  invokes `animation->OnValidateSnapshot(true)` for animations outside the
  timeline snapshot. This is a second live-map read after trigger state
  transition.
- `DocumentAnimations::UpdateTriggerAttachments()` first swaps
  `NamedTriggerAttachments()` into a copy before removing/adding triggers. This
  is local evidence that Blink animation code already uses snapshot discipline
  when trigger membership can be invalidated by lifecycle transitions.
- `TimelineTrigger::HandlePostTripAdd()` performs behavior under
  `is_activating_or_deactivating_`, but it is not a map loop. It remains useful
  as a reentrancy probe, not as the same iterator primitive.

## Deep source notes

`PerformBehavior()` installs `ScriptForbiddenScope`, so direct JS callbacks are
not the likely mutation source. Viable mutation paths are internal animation
state transitions:

- `PerformReset()` -> `Animation::ResetPlayback()` -> timing/play state changes.
- `Animation::cancel()` / `Animation::Dispose()` ->
  `Animation::DisassociateTriggers()` -> `trigger->removeAnimation(this)`.
- CSS attachment recomputation through `DocumentAnimations::UpdateTriggerAttachments()`.
- Compositor eligibility changes during
  `Animation::StartTriggeredAnimationOnCompositor()` and timeline validation.

The patch did not strengthen ownership or guard semantics. It only snapshots
the map for `PerformActivate()` and `PerformDeactivate()`. That narrows variant
hunt to remaining consumers of `BehaviorMap()` and to call chains where the
snapshot fix was applied in one entrypoint but not the sibling entrypoint.

## Hypotheses

H1 live-map mutation during activation:
Create several triggered animations. Trigger activation while one animation
operation causes a target/effect/trigger disassociation. Expected bad state:
iterator invalidation, DCHECK/CHECK, or stale `Member<Animation>` use.

H2 live-map mutation during deactivation:
Same as H1 but crossing the trigger range in the opposite direction to call
`PerformDeactivate()`.

H3 compositor-update variant:
Force composited triggered animations and detach/rewrite targets during
`UpdateCompositorTriggerAnimations()`, which still does not snapshot
`animation_behavior_map_`.

H4 cross-map class variant:
Search other Blink animation classes for live `HeapHashMap`/`HeapHashSet`
iteration that calls into `Animation` or DOM lifecycle methods.

H5 snapshot-timeline post-update variant:
Use a timeline trigger whose update changes trigger state. During the subsequent
`ScrollSnapshotTimeline::UpdateSnapshotInternal()` loop over
`trigger->BehaviorMap()`, force `OnValidateSnapshot(true)` to detach/reassociate
an animation. Expected bad state: mutation of `animation_behavior_map_` after
the trigger state transition but before snapshot validation completes.

H6 attachment-copy bypass:
Create several CSS animations with trigger attachments, then mutate
`animation-trigger` / owning element attachment scope during style recalc. The
target is not `UpdateTriggerAttachments()` itself because it copies; target is
callers that assume trigger map contents are stable after that copy step.

## Initial verdict

INCONCLUSIVE. Patch-diff primitive is strong, but runtime confirmation needs a
Chrome/content_shell/blink_unittests harness with `AnimationTrigger` enabled.
