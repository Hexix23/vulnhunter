// Paste into:
// components/viz/service/hit_test/hit_test_aggregator_unittest.cc
//
// Variant probe for CVE-2026-7360. Existing upstream test verifies immediate
// rejection and that the invalid list remains stored. This probes whether that
// stale stored region can become active after a later hierarchy mutation without
// a fresh compositor frame submission.

TEST_F(HitTestAggregatorTest, InvalidChildFrameSinkIdRejectedThenHierarchyChanges) {
  FrameSinkId parent_id(1, 1);
  FrameSinkId child_id(1, 2);
  FrameSinkId sibling_id(1, 3);

  frame_sink_manager()->RegisterFrameSinkId(parent_id, true);
  frame_sink_manager()->RegisterFrameSinkId(sibling_id, true);
  frame_sink_manager()->RegisterFrameSinkHierarchy(parent_id, child_id);
  frame_sink_manager()->RegisterFrameSinkHierarchy(parent_id, sibling_id);

  HitTestRegionList hit_test_region_list;
  hit_test_region_list.bounds = gfx::Rect(0, 0, 100, 100);

  HitTestRegion spoofed_sibling;
  spoofed_sibling.frame_sink_id = sibling_id;
  spoofed_sibling.flags = HitTestRegionFlags::kHitTestChildSurface |
                          HitTestRegionFlags::kHitTestMine;
  spoofed_sibling.rect = gfx::Rect(50, 50, 50, 50);
  hit_test_region_list.regions.push_back(spoofed_sibling);

  SurfaceId child_surface_id(
      child_id, LocalSurfaceId(1, 1, base::UnguessableToken::Create()));
  local_surface_id_lookup_delegate()->SetSurfaceIdMap(child_surface_id);

  auto child_support = std::make_unique<CompositorFrameSinkSupport>(
      nullptr, frame_sink_manager(), child_id, /*is_root=*/false);
  child_support->SubmitCompositorFrame(child_surface_id.local_surface_id(),
                                       MakeDefaultCompositorFrame(),
                                       std::move(hit_test_region_list), 0);

  hit_test_aggregator()->Aggregate(child_surface_id);
  EXPECT_EQ(1, hit_test_aggregator()->GetRegionCount());

  // Now make the stale spoofed target a legitimate child of child_id.
  frame_sink_manager()->RegisterFrameSinkHierarchy(child_id, sibling_id);

  // Force a new aggregation decision without submitting a fresh hit-test list.
  // If this now includes sibling_id, stale untrusted input was revalidated
  // against a later trusted hierarchy.
  hit_test_aggregator()->Aggregate(child_surface_id);

  // Desired security behavior: stale invalid data should not become active just
  // because hierarchy changed later.
  EXPECT_EQ(1, hit_test_aggregator()->GetRegionCount());
}
