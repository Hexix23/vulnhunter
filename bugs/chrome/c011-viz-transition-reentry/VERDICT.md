# C011 Verdict

Status: CONFIRMED-PRODUCT-ROUTE / IMPACT-PENDING

Confirmed from public patch:

- The original CVE class is a real iterator invalidation / reentry UAF in Viz
  transition processing.
- The accepted fix avoids erasing via an iterator that can become stale after
  transition processing reenters and mutates
  `view_transition_token_to_animation_manager_`.

Current variant status:

- H1 client callback reentry: confirmed ASan heap-use-after-free with local
  mock client. Evidence:
  `evidence/h1-client-callback-destroys-support.txt`.
- H2 non-bundled product Mojo client: refuted as synchronous reentry. A real
  `mojo::Remote<mojom::CompositorFrameSinkClient>` defers receiver execution
  until after `OnSaveTransitionDirectiveProcessed()` returns. Evidence:
  `evidence/h2-mojo-remote-client-async.txt`.
- H3 bundled product path: refuted as synchronous reentry. `BundleClientProxy`
  is direct C++, but it only forwards to
  `mojo::Remote<mojom::FrameSinkBundleClient>`, so the receiver callback runs
  after the save-completion stack unwinds. Evidence:
  `evidence/h3-bundle-client-async.txt`.
- H4 `FrameSinkObserver::OnViewTransitionSaved` destruction: confirmed
  synchronous crash sink. A synthetic observer destroying the support during
  `FrameSinkManagerImpl::CacheSurfaceAnimationManager()` trips a release
  `CHECK` in `base::ObserverList` reentrancy. Evidence:
  `evidence/h4-manager-observer-destroys-support.txt`. Product reachability is
  pending because the current product override is `Surface::OnViewTransitionSaved()`.
- H5 duplicate completion: refuted as memory-safety issue. Second completion is
  ignored after the first completion moves/erases local state. Evidence:
  `evidence/h5-h6-duplicate-and-cache-collision.txt`.
- H6 cache collision: confirmed observable logic behavior. Existing cached
  manager wins; newly completed manager is dropped after error log. No ASan
  crash, no VRP impact yet. Evidence:
  `evidence/h5-h6-duplicate-and-cache-collision.txt`.
- H7 pending animate during save completion: confirmed product route. During
  `CacheSurfaceAnimationManager()`, `Surface::OnViewTransitionSaved()` activates
  a pending frame and processes `kAnimateRenderer` synchronously. However, the
  old local map key still exists with a moved-out manager, so the animate path
  erases that local key and returns before taking the freshly cached global
  manager. Result: pending frame activates, animate is lost, global cache keeps
  the manager, local support map is empty. Evidence:
  `evidence/h7-product-route-lost-animate.txt`.
- H8 repeated H7 shape: confirmed global-cache growth. Repeating the product
  route with distinct tokens grows
  `FrameSinkManagerImpl::transition_token_to_animation_manager_` linearly unless
  each token is explicitly released. Evidence:
  `evidence/h8-repeated-lost-animate-cache-growth.txt`.
- H9 support teardown: confirmed survival past originating support teardown.
  After H7, destroying `CompositorFrameSinkSupport` does not clear the global
  cached manager; it remains in `FrameSinkManagerImpl` until explicit clear.
  Evidence: `evidence/h9-lost-animate-survives-support-teardown.txt`.
- H10-H12 release-order variants: confirmed cleanup boundary. Release in the
  activating frame, either after or before Animate, clears the cached manager.
  A later Release frame also clears H7 state. Evidence:
  `evidence/h10-h12-release-order-variants.txt`.
- H13 real posted callback: confirmed H7 without a direct/manual call to
  `OnSaveTransitionDirectiveProcessed()`. `SurfaceSavedFrame` posts the save
  completion callback and the lost-animate/global-cache state appears after
  `RunUntilIdle()`. Evidence:
  `evidence/h13-h14-real-callback-and-shared-resource.txt`.
- H14 shared-element resource variant: confirmed stronger impact shape. A
  shared-element save creates pending CopyOutputRequest state; the activating
  frame logs missing `SurfaceAnimationManager`, the manager remains cached
  globally, and source surface copy output remains pending. Evidence:
  `evidence/h13-h14-real-callback-and-shared-resource.txt`.
- H15 repeated shared-element variant: confirmed resource-bearing linear growth.
  Repeating H14 with distinct tokens grows global cache and leaves multiple
  saved source surfaces with pending copy requests. It also grows
  `TestSharedImageInterface::shared_image_count()` linearly. Evidence:
  `evidence/h15-repeated-shared-resource-cache-growth.txt`.
- H16 same-document control: refuted for same-doc movement. Same-doc posted
  completion keeps manager local; bug shape requires cross-frame/cross-frame-sink
  manager movement. Evidence: `evidence/h16-samedoc-control.txt`.
- H18 copy-completion retention: confirmed post-copy resource retention. After
  H14, taking and completing the pending CopyOutputRequest removes the pending
  request, but the global manager and saved shared image remain alive until
  explicit Release/clear. Evidence:
  `evidence/h18-copy-completion-retention.txt`.
- H19 large shared-image retention: confirmed resource size impact. The same
  H18 shape with a 4096x4096 shared element retains a
  `ClientSharedImage` whose `EstimatedSizeInBytes()` is 67,108,864 bytes after
  copy completion, until explicit clear. Evidence:
  `evidence/h19-large-shared-image-retention.txt`.
- H20 Blink release-delay source audit: confirmed product cleanup can be
  delayed by active view-transition animations or stable
  `ViewTransition.waitUntil()` promises before Blink emits
  `ViewTransitionRequest::CreateRelease()`. Evidence:
  `evidence/h20-blink-release-delay-source-audit.txt`.

Baseline:

- Upstream regression `OnSaveTransitionDirectiveProcessedReentryUAF` passes
  under ASan when run with:
  `ASAN_OPTIONS=detect_odr_violation=0 xvfb-run -a out/c001_asan/viz_unittests --gtest_filter='*OnSaveTransitionDirectiveProcessedReentryUAF*' --single-process-tests`.

VRP status:

- Not report-ready yet, but no longer only synthetic.
- Confirmed sinks: H1 direct client UAF, H4 observer reentrancy CHECK.
- Confirmed product variant: H7-H9, H13-H15, H18, and H19 lost-animate, global
  cache growth, retained shared-image resources after copy completion,
  quantified 64 MiB retained shared image, and survival past support teardown.
- Confirmed cleanup boundary: H10-H12 show Release clears the state.
- Confirmed scope boundary: H16 shows same-document flow is not affected.
- Refuted reachability: normal Mojo client and bundled client are async.
- Remaining useful path: turn H20 into browser-level proof. Specifically:
  demonstrate from HTML/content shell that cross-document view transitions with
  large shared elements can outpace/delay Release enough to cause browser/GPU
  memory pressure. H15/H19 already confirm resource-bearing retention in Viz
  when Release is delayed or absent.

Infra notes:

- `out/c001_asan/viz_unittests` now builds successfully in OrbStack Ubuntu.
- Raw ASan run needs `ASAN_OPTIONS=detect_odr_violation=0`; otherwise component
  shared-library ODR duplicate vtables abort before tests run.
- VM is headless, so Viz tests need `xvfb-run -a`; otherwise GL init fails at
  `ui/gl/test/gl_surface_test_support.cc`.
