# C009 Pseudo-Element Event Target Lifetime Walkthrough

Goal: variant hunt from stable patch
`95def1bd07956197f249712a35070ca3efda7d84`, original
`82777e870bf03d3d0f5fa21dad8a9311a8a69d5b`.

## Fixed bug fingerprint

Patch subject: `[M147] Fix click dispatch for ephemeral hit-testable pseudo-elements`.

The patch hardens input state when a hit-testable pseudo-element is removed:

- `PseudoElement::Dispose()` now notifies `EventHandler` before orphaning the
  pseudo (`SetParentNode(nullptr)` / `RemovedFrom()`).
- `MouseEventManager::HandlePseudoElementRemoval()` rewrites cached
  `mousedown_element_`, `mouse_press_node_`, and `element_under_mouse_` to the
  pseudo's originating element.
- `PointerEventManager::HandlePseudoElementRemoval()` rewrites
  `element_under_pointer_`, pointer capture maps, and forwards into
  `PointerEventFactory` and `TouchEventManager`.
- `PointerEventFactory::HandlePseudoElementRemoved()` rewrites stored
  pointerdown/pointerup click targets.
- `TouchEventManager::HandlePseudoElementRemoval()` rewrites active touch
  targets.

## Trust boundary

Web content controls style and event handlers. A page can make a pseudo-element
hit-testable, receive pointer/mouse/touch input, and synchronously remove the
pseudo during event dispatch by changing style/classes. Blink must not keep a
stale pseudo node in cached input state after style recalc/dispose.

## Source invariants

- `PseudoElement::SupportsHitTesting()` returns true unconditionally for
  interest buttons, scroll markers, scroll marker groups, and scroll buttons.
- `::before`, `::after`, and `::marker` are hit-testable when
  `PseudoElementsHitTestableEnabled` is enabled.
- Removal notification must happen while `ParentOrShadowHostElement()` is still
  available.
- All event target caches that can later dispatch click, compat mouse, pointer
  boundary, pointer capture, or touch events must be updated together.
- `NonDeletedElementTarget()` is an ad-hoc fallback based on event path; it does
  not cover all persistent caches.

## Hypotheses

H1 generic pseudo target stale click:
Hit-test `::before` / `::after`, remove it during pointerdown, then pointerup.
Expected bug in old code: click dispatch uses stale pseudo target or loses
target consistency. Variant target: nested pseudo/marker where the parent
rewrite chooses the wrong originating element.

H2 pointer capture stale pseudo:
Pointerdown on a hit-testable pseudo, call `setPointerCapture()` on the
originating element, remove pseudo, release on pointerup. Probe
`pointer_capture_target_` and pending capture rewrite.

H3 touch target stale pseudo:
Touchstart on a hit-testable pseudo removes it, then touchend/tap click uses
`TouchEventManager` and recently removed pointer attributes. Probe mobile touch
pipeline, not mouse.

H4 nested pseudo removal:
Hit-test a nested pseudo (e.g. `::marker` inside pseudo or scroll marker
pseudos). `HandlePseudoElementRemoved()` checks
`pseudo.IsShadowIncludingInclusiveAncestorOf(target)` and rewrites to the
removed pseudo's parent. Probe whether nested pseudo removal should rewrite to
ultimate originating element instead of immediate pseudo parent.

H5 non-style DOM removal sibling:
Patch only adds pseudo removal handling. For normal node removal,
`HandleRemoveSubtree()` has separate semantics. Probe mixed subtree where a
regular element removal also disposes hit-testable pseudo children and cached
state observes callbacks in the wrong order.

## Current verdict

Strong patch-derived event lifetime primitive. Needs runtime confirmation.
This is likely logic/UAF-adjacent but not reportable until a crash, DCHECK,
event target confusion with security impact, or cross-document/capture
integrity violation is demonstrated.
