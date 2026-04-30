// Paste into:
// components/viz/service/hit_test/hit_test_aggregator_unittest.cc
//
// Logic/DoS probe: current AppendRegion caller breaks on the first invalid
// child. This checks whether invalid data can suppress later valid regions.

TEST_F(HitTestAggregatorTest, InvalidChildDoesNotSuppressLaterValidChild) {
  FrameSinkId parent_id(1, 1);
  FrameSinkId child_id(1, 2);
  FrameSinkId valid_grandchild_id(1, 3);
  FrameSinkId sibling_id(1, 4);

  frame_sink_manager()->RegisterFrameSinkId(parent_id, true);
  frame_sink_manager()->RegisterFrameSinkId(sibling_id, true);
  frame_sink_manager()->RegisterFrameSinkHierarchy(parent_id, child_id);
  frame_sink_manager()->RegisterFrameSinkHierarchy(child_id, valid_grandchild_id);

  HitTestRegionList child_list;
  child_list.bounds = gfx::Rect(0, 0, 100, 100);

  HitTestRegion invalid;
  invalid.frame_sink_id = sibling_id;
  invalid.flags = HitTestRegionFlags::kHitTestChildSurface |
                  HitTestRegionFlags::kHitTestMine;
  invalid.rect = gfx::Rect(0, 0, 10, 10);
  child_list.regions.push_back(invalid);

  HitTestRegion valid;
  valid.frame_sink_id = valid_grandchild_id;
  valid.flags = HitTestRegionFlags::kHitTestChildSurface |
                HitTestRegionFlags::kHitTestMine;
  valid.rect = gfx::Rect(20, 20, 10, 10);
  child_list.regions.push_back(valid);

  SurfaceId child_surface_id(
      child_id, LocalSurfaceId(1, 1, base::UnguessableToken::Create()));
  local_surface_id_lookup_delegate()->SetSurfaceIdMap(child_surface_id);

  auto child_support = std::make_unique<CompositorFrameSinkSupport>(
      nullptr, frame_sink_manager(), child_id, /*is_root=*/false);
  child_support->SubmitCompositorFrame(child_surface_id.local_surface_id(),
                                       MakeDefaultCompositorFrame(),
                                       std::move(child_list), 0);

  hit_test_aggregator()->Aggregate(child_surface_id);

  // If this fails with count 1, invalid data suppressed a later valid child.
  EXPECT_EQ(2, hit_test_aggregator()->GetRegionCount());
}
