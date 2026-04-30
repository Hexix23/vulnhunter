// Insert into:
// components/user_education/common/help_bubble/help_bubble_factory_registry_unittest.cc
//
// Purpose:
// Exercise HelpBubbleFactoryRegistry live map iteration when a virtual bubble
// callback synchronously closes the current bubble and triggers
// HelpBubbleFactoryRegistry::OnHelpBubbleClosing(), which erases from the same
// map being iterated.

namespace {

class ClosingOnBoundsBubble : public test::TestHelpBubble {
 public:
  ClosingOnBoundsBubble(ui::TrackedElement* element, HelpBubbleParams params)
      : test::TestHelpBubble(element, std::move(params)) {}

  void OnAnchorBoundsChanged() override {
    Close(CloseReason::kAnchorHidden);
  }
};

class ClosingOnFocusBubble : public test::TestHelpBubble {
 public:
  ClosingOnFocusBubble(ui::TrackedElement* element, HelpBubbleParams params)
      : test::TestHelpBubble(element, std::move(params)) {}

  bool ToggleFocusForAccessibility() override {
    Close(CloseReason::kProgrammaticallyClosed);
    return false;
  }
};

}  // namespace

TEST_F(HelpBubbleFactoryRegistryTest,
       NotifyAnchorBoundsChangedLiveIterationCloseCurrent) {
  auto bubble = std::make_unique<ClosingOnBoundsBubble>(&test_element_,
                                                        GetBubbleParams());
  auto second = help_bubble_factory_registry_.CreateHelpBubble(
      &test_element_, GetBubbleParams());

  help_bubble_factory_registry_.AddHelpBubble(bubble.get());

  help_bubble_factory_registry_.NotifyAnchorBoundsChanged(kTestElementContext);

  EXPECT_FALSE(bubble->is_open());
  second.reset();
}

TEST_F(HelpBubbleFactoryRegistryTest,
       ToggleFocusForAccessibilityLiveIterationCloseCurrentAndContinue) {
  auto bubble =
      std::make_unique<ClosingOnFocusBubble>(&test_element_, GetBubbleParams());
  auto second = help_bubble_factory_registry_.CreateHelpBubble(
      &test_element_, GetBubbleParams());

  help_bubble_factory_registry_.AddHelpBubble(bubble.get());

  help_bubble_factory_registry_.ToggleFocusForAccessibility(kTestElementContext);

  EXPECT_FALSE(bubble->is_open());
  second.reset();
}
