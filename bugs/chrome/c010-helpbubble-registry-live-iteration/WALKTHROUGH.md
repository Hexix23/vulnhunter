# C010 HelpBubbleFactoryRegistry Live Iteration

Source range: Chrome `147.0.7727.136..147.0.7727.137`

Parent finding: R1-C4 / HelpBubble teardown hardening.

## Invariant

`HelpBubbleFactoryRegistry` tracks non-owned `HelpBubble*` values in:

```cpp
std::map<raw_ptr<HelpBubble>, base::CallbackListSubscription> help_bubbles_;
```

The stable hardening patch made teardown safer by separating "closing" from
"closed" callbacks and by avoiding mutation of this registry during destructor
iteration.

The broader invariant is:

Any method iterating `help_bubbles_` must not call into virtual bubble code that
can synchronously close the bubble and erase the current map entry.

## Source Review

Current destructor already recognizes the mutation hazard:

```cpp
for (auto& pr : help_bubbles_) {
  pr.second = base::CallbackListSubscription();
  pr.first->Close(HelpBubble::CloseReason::kBubbleDestroyed);
}
```

It unsubscribes before `Close()` specifically so the `OnHelpBubbleClosing()`
callback cannot erase from `help_bubbles_` while the destructor iterates.

Two other methods still iterate the live map and invoke virtual bubble methods:

```cpp
void HelpBubbleFactoryRegistry::NotifyAnchorBoundsChanged(
    ui::ElementContext context) {
  for (const auto& pr : help_bubbles_) {
    if (pr.first->GetContext() == context) {
      pr.first->OnAnchorBoundsChanged();
    }
  }
}
```

```cpp
bool HelpBubbleFactoryRegistry::ToggleFocusForAccessibility(
    ui::ElementContext context) {
  for (const auto& pr : help_bubbles_) {
    if (pr.first->GetContext() == context &&
        pr.first->ToggleFocusForAccessibility()) {
      return true;
    }
  }
  return false;
}
```

`NotifyAnchorBoundsChanged()` is the stronger sink because it continues the
range-for loop after the virtual call. If the current bubble closes during
`OnAnchorBoundsChanged()`, `OnHelpBubbleClosing()` erases the current map entry
and the loop increments an invalidated iterator.

`ToggleFocusForAccessibility()` is lower risk because a true return exits
immediately; a closing implementation that returns false can still force the
same erase-then-continue pattern.

## Hypotheses

H1: A bubble closes itself from `OnAnchorBoundsChanged()`. The registry erases
the current element during live iteration and then continues the range-for.

H2: A bubble closes itself from `ToggleFocusForAccessibility()` and returns
false. The registry continues iteration after the current entry was erased.

H3: A custom/external HelpBubble implementation uses the public
`AddHelpBubble()` API and triggers H1/H2 without going through the standard
factory implementation.

## Current Status

Candidate, not yet confirmed in a built test binary. The attached gtest snippets
are designed to be inserted into
`components/user_education/common/help_bubble/help_bubble_factory_registry_unittest.cc`.

If ASAN/iterator checks confirm this, impact is likely a UI-process memory
safety bug reachable by internal/user-education UI state changes rather than a
direct web renderer primitive. It is still worth validating because the parent
patch is a stable security hardening commit for the same callback/teardown
surface.
