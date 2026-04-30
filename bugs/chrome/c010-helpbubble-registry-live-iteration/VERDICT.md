# Verdict

Status: `INCONCLUSIVE`

Signal:
- Live `std::map<raw_ptr<HelpBubble>, ...>` iteration.
- Virtual callbacks invoked from inside the loop.
- The close callback registered by `AddHelpBubble()` erases from the same map.
- The destructor already has a local mitigation for the exact mutation class,
  but `NotifyAnchorBoundsChanged()` and `ToggleFocusForAccessibility()` do not.

Missing proof:
- Need a built `components_unittests` or a smaller local harness to execute the
  gtest snippets under ASAN/iterator diagnostics.
- Build attempts against `components_unittests` and
  `components/user_education/common:unit_tests` were intentionally stopped
  because they expanded to broad Chromium builds rather than a fine target.
  See `evidence/build-attempt.txt`.

Next validation:
1. Patch the two tests from `poc/h1-h2-registry-live-iteration-test.cc` into
   `help_bubble_factory_registry_unittest.cc`.
2. Build `//components:components_unittests`.
3. Run:

```bash
out/c001_asan/components_unittests \
  --gtest_filter='HelpBubbleFactoryRegistryTest.*LiveIteration*'
```

Expected result if vulnerable:
- ASAN/UAF, CHECK/iterator diagnostic, or crash during map iteration after erase.

Expected result if protected by implementation accident:
- Both tests pass; refute H1/H2 and document why `std::map` iteration does not
  resume after current erase in these paths.
