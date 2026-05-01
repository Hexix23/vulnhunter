# C011 VRP Test Matrix

Status: primitive confirmed; VRP impact pending browser-level proof.

## Confirmed on AWS release+dcheck

- H22/H23 shared-resource retention:
  - `SharedElementLostAnimateRetainsManagerAfterCopyCompletion`
  - `SharedElementLostAnimateRetainsLargeSharedImageAfterCopyCompletion`
  - `RepeatedSharedElementLostAnimateGrowsCacheAndPendingCopies`
  - Evidence: `evidence/h25-aws-h22-h23-viz-unittests-release.txt`
  - Result: lost animate leaves cached managers and retained shared images after copy completion and support teardown.

- Control/variant set:
  - `OnSaveTransitionDirectiveProcessedPendingAnimateLeavesManagerCached`
  - `OnSaveTransitionDirectiveProcessedRepeatedLostAnimateGrowsCache`
  - `OnSaveTransitionDirectiveProcessedLostAnimateSurvivesSupportTeardown`
  - `OnSaveTransitionDirectiveProcessedAnimateThenReleaseClearsLostManager`
  - `OnSaveTransitionDirectiveProcessedReleaseThenAnimateClearsLostManager`
  - `OnSaveTransitionDirectiveProcessedLaterReleaseClearsLostManager`
  - `SameDocumentPostedCompletionKeepsManagerLocal`
  - `OnSaveTransitionDirectiveProcessedMojoRemoteClientIsAsync`
  - `FrameSinkBundleImplTest.OnSaveTransitionDirectiveProcessedBundleClientIsAsync`
  - Evidence: `evidence/h26-aws-c011-controls-release.txt`
  - Result: release paths clear; same-document path does not reproduce; Mojo client callback is not the vector.

## Pending for VRP

- H21 browser/product route:
  - Test: `ViewTransitionProcessShutdownTest.LargeSharedElementWaitUntilKeepsUnclaimedResources`
  - Target: `out/c011_rel/content_browsertests`
  - Required proof: web navigation creates view-transition resources, `waitUntil()` delays release, and `HasUnclaimedViewTransitionResources()` is true until cleanup.

- Web-scale impact variants:
  - repeated navigations with distinct tokens;
  - large shared element sizes;
  - delayed release via long CSS animation;
  - delayed release via `ViewTransition.waitUntil()`;
  - tab close / renderer teardown while resources remain;
  - browser/GPU process memory growth or crash/OOM.

## VRP acceptance bar

Reportable if browser-level testing proves at least one:

- HTML/web reachable retained GPU/shared resources with unbounded or attacker-controlled growth;
- browser/GPU process crash or OOM from crafted page;
- stale manager/resource survives lifecycle teardown with security-relevant resource retention;
- cross-document/cross-frame lifecycle invariant violation with concrete user harm.

Not sufficient alone:

- unit-only map mutation;
- synthetic observer crash;
- retained object with no browser/web route;
- state that product always clears before attacker can amplify it.
