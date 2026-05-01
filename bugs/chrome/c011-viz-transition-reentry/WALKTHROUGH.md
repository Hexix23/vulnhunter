# C011 Viz Transition Directive Reentry

Source lineage:

- CVE-2026-7357, issue `497047552`
- Main patch: <https://chromium-review.googlesource.com/c/chromium/src/+/7717958>
- Backports: `7783688` (M147), `7781119` (M148)

Patch fingerprint:

- File: `components/viz/service/frame_sinks/compositor_frame_sink_support.cc`
- Function: `CompositorFrameSinkSupport::OnSaveTransitionDirectiveProcessed`
- The patch changed erase-by-iterator to erase-by-key:
  `view_transition_token_to_animation_manager_.erase(it)` became
  `erase(directive.transition_token())`.
- Reason from patch comment: a callback can activate a pending frame, register
  more transition requests, and mutate/reallocate
  `view_transition_token_to_animation_manager_`; the old iterator becomes
  invalid.

Regression test:

- File: `components/viz/service/frame_sinks/compositor_frame_sink_support_unittest.cc`
- Test: `OnSaveTransitionDirectiveProcessedReentryUAF`
- Shape:
  1. Create surface A and a save directive for token X.
  2. Submit frame B that waits on token X and also registers many new save
     transition directives.
  3. Call `OnSaveTransitionDirectiveProcessed` for token X.
  4. Completion activates frame B; frame B mutates the transition-manager map;
     stale iterator use would crash.

Local source notes:

- `OnSaveTransitionDirectiveProcessed` still takes an iterator before
  `client_->OnCompositorFrameTransitionDirectiveProcessed(...)`.
- It then moves `it->second` into `CacheSurfaceAnimationManager()` and erases by
  key only for `maybe_cross_frame_sink()`.
- The public test exercises mutation during cache/activation. It does not fully
  prove safety for client callback reentry, non-cross-frame-sink paths, duplicate
  completion, or support destruction from the client callback.

Variant hypotheses:

- H1 client callback reentry: `client_->OnCompositorFrameTransitionDirectiveProcessed`
  destroys the support or mutates `view_transition_token_to_animation_manager_`
  before the function resumes and uses `it`.
- H2 duplicate completion: same save directive completes twice after the first
  completion moved or erased the manager.
- H3 non-cross-frame-sink completion: `maybe_cross_frame_sink()==false` returns
  after the client callback without moving/erasing the manager; callback-triggered
  mutation may leave stale state for later cleanup.
- H4 multi-token collision: callback processes another transition with the same
  token or sequence-id shape and mutates the map entry that `it` references.

Round 2 deep reachability:

- H3 real bundled client path:
  - `CompositorFrameSinkImpl` gives bundled supports a direct
    `BundleClientProxy*`.
  - `BundleClientProxy::OnCompositorFrameTransitionDirectiveProcessed()` calls
    `FrameSinkBundleImpl::SendOnCompositorFrameTransitionDirectiveProcessed()`.
  - That method forwards over `mojo::Remote<mojom::FrameSinkBundleClient>`.
  - ASan test proved receiver destruction runs only after
    `client_receiver_.FlushForTesting()`, not during
    `OnSaveTransitionDirectiveProcessed()`.
  - Verdict: refuted as sync UAF reach.

- H4 manager observer sink:
  - `FrameSinkManagerImpl::CacheSurfaceAnimationManager()` stores the manager,
    then synchronously iterates `observer_list_` and calls
    `FrameSinkObserver::OnViewTransitionSaved()`.
  - Synthetic observer that resets the support during this callback crashes with
    a release `CHECK` in `base::ObserverList` reentrancy.
  - Symbolized path:
    `CacheSurfaceAnimationManager()` ->
    `CompositorFrameSinkSupport::~CompositorFrameSinkSupport()` ->
    `FrameSinkManagerImpl::UnregisterCompositorFrameSinkSupport()` ->
    `base::ObserverList` reentrancy check.
  - Product reachability is not confirmed. Current product override found for
    `OnViewTransitionSaved()` is `Surface::OnViewTransitionSaved()`, which
    activates pending frames; that is the public CVE iterator invalidation shape.

- H5 duplicate completion:
  - First completion moves local manager to `FrameSinkManagerImpl` and erases
    local state.
  - Second completion finds no local entry and returns.
  - Verdict: no memory-safety signal.

- H6 cache collision:
  - If a manager already exists for the same transition token,
    `CacheSurfaceAnimationManager()` logs an error and returns.
  - The newly completed local manager is dropped; old cached manager remains.
  - Verdict: observable logic edge, no ASan crash, no VRP impact yet without a
    token-reuse/cross-frame security consequence.

- H7 product pending-animate route:
  - Shape: active surface A starts cross-frame Save for token X. A new surface B
    is submitted with `kAnimateRenderer` for token X and
    `delay_layer_tree_view_deletion=true`, so B waits on X.
  - `OnSaveTransitionDirectiveProcessed()` moves the local manager into
    `FrameSinkManagerImpl::CacheSurfaceAnimationManager()`.
  - `CacheSurfaceAnimationManager()` synchronously notifies `Surface`.
  - `Surface::OnViewTransitionSaved()` activates pending surface B.
  - `CompositorFrameSinkSupport::OnSurfaceActivated()` processes B's
    `kAnimateRenderer`.
  - The local map still contains token X, but its `unique_ptr` has already been
    moved out. The animate path sees the local key, erases it, and returns
    before `TakeSurfaceAnimationManager(token X)`.
  - Result: B activates, animate is lost, global manager remains cached.
  - Evidence: `evidence/h7-product-route-lost-animate.txt`.

- H8 repeated H7 route:
  - The H7 shape was repeated with eight distinct tokens.
  - Each iteration activated the pending frame and left its
    `SurfaceAnimationManager` in
    `FrameSinkManagerImpl::transition_token_to_animation_manager_`.
  - The test asserts cache size after each iteration: `i + 1`.
  - Verdict: renderer-controllable global-cache growth primitive, impact still
    pending.
  - Evidence: `evidence/h8-repeated-lost-animate-cache-growth.txt`.

- H9 teardown lifetime:
  - Starts with the H7 state: token X cached globally, absent locally, pending
    frame activated.
  - Destroys the originating `CompositorFrameSinkSupport`.
  - The cached manager still remains in `FrameSinkManagerImpl`.
  - Verdict: the primitive survives support teardown/navigation-like destruction
    unless explicit Release or manager clear happens.
  - Evidence: `evidence/h9-lost-animate-survives-support-teardown.txt`.

- H10-H12 Release boundary:
  - `Animate` then `Release` in the activating frame clears the H7 cached
    manager.
  - `Release` then `Animate` also clears it; the later Animate logs missing
    manager.
  - A separate later Release frame clears the H7 cached manager.
  - Verdict: normal Release is an effective cleanup path. The impact path
    requires Release to be delayed, omitted, or outpaced.
  - Evidence: `evidence/h10-h12-release-order-variants.txt`.

- H13 real posted save-completion callback:
  - Same H7 shape, but no direct test call to
    `OnSaveTransitionDirectiveProcessed()`.
  - `SurfaceSavedFrame` posts the completion callback; `base::RunLoop()` drives
    it.
  - Verdict: product callback scheduling is enough to hit the bug state.
  - Evidence: `evidence/h13-h14-real-callback-and-shared-resource.txt`.

- H14 shared-element/copy-output variant:
  - Save frame includes a shared-element render pass.
  - Save processing creates a CopyOutputRequest and early-acks completion.
  - Pending animate activates and tries to replace shared-element resources, but
    local manager lookup is empty; Viz logs
    `No SurfaceAnimationManager for token`.
  - Global manager remains cached and source surface still has pending copy
    output work.
  - Evidence: `evidence/h13-h14-real-callback-and-shared-resource.txt`.

- H15 repeated shared-element/copy-output growth:
  - Repeats H14 for four distinct tokens.
  - Each iteration leaves one global cached manager and one saved source surface
    with pending copy output work.
  - The fixture also asserts `TestSharedImageInterface::shared_image_count()`
    grows by one per token.
  - Verdict: resource-bearing linear growth primitive in Viz.
  - Evidence: `evidence/h15-repeated-shared-resource-cache-growth.txt`.

- H16 same-document control:
  - Same posted callback shape with `maybe_cross_frame_sink=false`.
  - Manager remains local and no global cache entry is created.
  - Verdict: affected shape is cross-frame/cross-frame-sink manager movement,
    not same-doc.
  - Evidence: `evidence/h16-samedoc-control.txt`.

- H18 copy-completion retention:
  - Starts with H14 shared-element lost-animate state.
  - Takes the pending CopyOutputRequest from the source surface and sends a
    shared-image result to simulate display/copy completion.
  - After completion, the source surface no longer has pending copy requests.
  - The global manager still exists and the saved shared image remains alive
    until explicit `ClearSurfaceAnimationManager(token)`.
  - Verdict: retention survives copy completion; impact is retained saved
    shared-image resource, not merely a pending-copy bookkeeping artifact.
  - Evidence: `evidence/h18-copy-completion-retention.txt`.

- H19 large shared-image retention:
  - Same as H18, but the shared element uses a 4096x4096 render pass.
  - The test asserts the retained `ClientSharedImage` has
    `gfx::Size(4096, 4096)` and `EstimatedSizeInBytes() == 67,108,864`.
  - After copy completion, the source surface has no pending copy requests, but
    the global manager and shared image remain alive until explicit
    `ClearSurfaceAnimationManager(token)`.
  - Verdict: the retained state can carry large GPU/shared-image resources.
  - Evidence: `evidence/h19-large-shared-image-retention.txt`.

- H21 browser waitUntil probe:
  - Added `content_browsertests` coverage for same-origin cross-document view
    transition with `pagereveal.waitUntil()` keeping Release delayed.
  - Harness fixes made during review: the HTML now actually creates the
    `#target` shared element, and second navigation uses same-origin COOP to
    match Chromium's existing process-swap view-transition test shape.
  - ASan content build failed in V8 `mksnapshot`, not in C011 code.
  - Non-ASan content build was started but paused because the cold
    `content_browsertests` target was too large for this iteration.
  - Evidence: `evidence/h21-asan-build-mksnapshot-failure.txt`.

- H22 support teardown after copy completion:
  - Extended H18/H19 to call `support_.reset()` after copy completion.
  - Both tests still assert one cached manager and one shared image after
    support teardown.
  - Large variant keeps the 4096x4096 / 67,108,864 byte assertion.
  - Verdict: retained resource lifetime is in `FrameSinkManagerImpl` cached
    manager, not only in source `CompositorFrameSinkSupport`.
  - Evidence: `evidence/h22-shared-image-survives-support-teardown.txt`.

- H23 repeated large copy-completed teardown:
  - Strengthened H15 from small pending-copy growth into large completed-copy
    retention.
  - Four distinct tokens each use a 4096x4096 shared element.
  - All pending copy requests are completed.
  - Total retained estimate is asserted as 268,435,456 bytes.
  - `support_.reset()` does not clear the four cached managers or four shared
    images.
  - Verdict: the primitive scales linearly and survives renderer/support
    teardown after copy completion.
  - Evidence: `evidence/h23-repeated-large-copy-completed-teardown.txt`.

- H24 browser/content-shell build:
  - Non-ASan `content_browsertests` was resumed for H21, then paused because
    the cold target remained too large.
  - `content_shell` was attempted as a smaller HTML PoC vehicle, but still had
    37k targets and was paused after healthy progress.
  - The H21 HTML harness is still staged and corrected in the VM.
  - Verdict: browser-level validation is infra-blocked by build throughput, not
    by a failed hypothesis.
  - Evidence: `evidence/h24-browser-build-bottleneck.txt`.

Blink/cc release path notes:

- `third_party/blink/renderer/core/view_transition/view_transition.cc` sends
  `ViewTransitionRequest::CreateRelease()` in `SkipTransition()` once the
  transition is past capture-tag discovery.
- The normal completion path also sends Release in state `kPendingDone`.
- Before `kPendingDone`, Blink intentionally stays in `kAnimating` while
  `style_tracker_->HasActiveAnimations()` or
  `wait_until_pending_promise_count_ > 0`.
- `ViewTransition.waitUntil(Promise)` is stable in this checkout and increments
  `wait_until_pending_promise_count_` until the supplied promise settles.
- `features::kDelayLayerTreeViewDeletionOnLocalSwap` is enabled by default.
- `cc/trees/layer_tree_host_impl.cc` serializes pending transition requests into
  `CompositorFrameMetadata::transition_directives`; with early-ack view
  transitions, animate directives can be acked before copy output is fulfilled.
- Therefore H8/H9/H15/H19 impact question is now narrower: can a web page create
  enough concurrent/distinct cross-document view-transition tokens with large
  shared elements while delaying Release via animations or `waitUntil()`, so the
  retained browser/GPU resources cross VRP threshold?

Validation plan:

1. Build `viz_unittests`.
2. Replay upstream regression test:
   `out/c001_asan/viz_unittests --gtest_filter=*OnSaveTransitionDirectiveProcessedReentryUAF*`
3. Add a local test variant for H1 using a mock client callback that calls
   `support.reset()` or triggers transition map mutation before returning.
4. Add H2/H3 targeted tests if H1 is refuted by ownership/lifetime guards.

Next useful work:

1. Convert H15 into report-grade impact:
   - H19 quantified one retained 4096x4096 RGBA shared image as 64 MiB;
   - next prove the same shape from a browser/content-shell HTML testcase.
2. Check browser-level reach:
   - cross-document View Transition API;
   - active animation / `waitUntil()` paths that delay Release;
   - navigation/visibility/abort cases around `kPendingDone`.
3. If H8 resource impact stalls, pivot to same window with `Release(token X)` in
   the activating frame: Save completion caches X while activation immediately
   clears/takes X, then the caller resumes and erases by key.
