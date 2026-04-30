# C008 Viz Hit-Test Hierarchy Validation Walkthrough

Goal: variant hunt from stable patch
`97dd88c8e2f9a04b55e4644e521c1d3b6e138c2e`, original
`00116e7002fb40c113daaff72864bbe00590e28b`.

## Fixed bug fingerprint

Patch subject: `[M147] viz: Add hierarchy validation to HitTestAggregator`.

Public CVE mapping from Chrome stable release: CVE-2026-7360, "Insufficient
validation of untrusted input in Compositing".

The relevant stable code now validates child hit-test regions during
aggregation:

```cpp
if (base::FeatureList::IsEnabled(kRejectInvalidChildRegions) &&
    !delegate_->IsChildOf(submitting_frame_sink_id, region.frame_sink_id)) {
  return base::unexpected(AggregationError::INVALID_CHILD_REGION);
}
```

`FrameSinkManagerImpl::IsChildOf(parent, child)` only checks direct children in
`frame_sink_source_map_[parent].children`.

## Trust boundary

Renderer / compositor clients submit `HitTestRegionList` with compositor frames.
Viz host owns trusted FrameSink hierarchy. A renderer-controlled list must not
claim that an unrelated sibling/ancestor/foreign frame sink is its child.

`HitTestManager::ValidateHitTestRegionList()` explicitly does not validate the
hierarchy on submission because hierarchy and hit-test data arrive
asynchronously. Therefore the security check is in `HitTestAggregator`.

## Source invariants

- Submitted `HitTestRegionList` may be stored even if it contains an invalid
  child region.
- Aggregation must reject any child surface region that is not a direct child
  of the currently submitting frame sink.
- Rejection omits the invalid aggregated region but intentionally leaves the
  original stored `HitTestRegionList` intact.
- If a region has `client_id()==0`, `ValidateHitTestRegionList()` rewrites it
  to use the submitting surface's client id before later aggregation.
- Cycle prevention is independent: `referenced_child_regions_` prevents
  recursive cycles but does not prove hierarchy membership.
- The fix is behind enabled-by-default feature
  `kRejectInvalidChildRegions`, marked TODO remove after M150.

## Hypotheses

H1 stale invalid list becomes valid after hierarchy mutation:
Submit a child frame with hit-test data spoofing a sibling. Aggregation rejects
it. Then change trusted hierarchy so the spoofed frame sink becomes a direct
child of the submitter without a fresh frame submission. If the old stored
hit-test region becomes active, this is a TOCTOU integrity bug.

Refinement: `HitTestAggregator::Aggregate()` returns early unless
`submit_hit_test_region_list_index_` changes. A hierarchy-only mutation does not
appear to trigger reaggregation. Existing test comments also say keeping the
list is intentional so it can aggregate if hierarchy changes. H1 only remains
interesting if a later unrelated hit-test submission revalidates stale hostile
data in a way that crosses security ownership, not just async correctness.

H2 invalid-first child truncates later valid regions:
Submit regions `[invalid sibling, valid child]`. Current code breaks the child
loop on invalid, so later valid child regions are omitted. Likely DoS/logic
only, but could become security if an attacker-controlled subframe suppresses
input routing for another frame.

Refinement: this likely affects only the submitting surface's own descendant
list. Without cross-frame ownership of the valid later region, impact is likely
self-DoS / routing degradation, not VRP.

H3 zero-client-id remap collision:
Submit child region with `FrameSinkId(0, target_sink_id)`. Submit validation
rewrites client id to the submitting client. Probe whether same-client sibling
sink ids can be spoofed through this remap or whether direct hierarchy check
always rejects.

H4 feature-flag footgun:
Because this security validation is behind an enabled-by-default feature, any
Finch/command-line disable path reopens the primitive. This is normally not VRP
by itself, but it is important for regression review until TODO removal.

## Current verdict

Strong patch-derived primitive. No confirmed variant yet. Best next action is a
focused `HitTestAggregatorTest` for H1 and H2 because existing upstream test
only covers immediate rejection and confirms the invalid stored list remains
present.
