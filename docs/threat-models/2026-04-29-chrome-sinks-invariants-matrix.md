# Chrome 147 CVE-Derived Sinks And Invariants

Working source: Chrome Stable update, April 28, 2026. This matrix converts the CVE classes into source audit targets. One candidate, one boundary, one violated contract.

## Global Sinks

S-LIFE-1 Posted tasks and callbacks:
Look for `PostTask`, `BindOnce`, `BindRepeating`, callbacks storing raw `this`, `Unretained`, delayed completion callbacks, and worker/main-thread hops.
Invariant: any object referenced by an async task must be refcounted, persistent, weak-checked, or synchronously cancelled before dispose.

S-LIFE-2 Dispose/Stop/Detach/Reset:
Look for `Dispose`, `Stop`, `ContextDestroyed`, `Detach`, `Reset`, `TearDown`, `Close`, `OnDestruct`.
Invariant: after terminal lifecycle state, no compositor/GPU/media/browser task may dereference stale object state.

S-LIFE-3 Cross-owned resources:
Look for `scoped_refptr`, `raw_ptr`, `Member`, `WeakMember`, `WeakPtr`, `unique_ptr`, `RefCounted`, `CrossThreadPersistent`.
Invariant: ownership model must match actual thread/process lifetime, not just local call stack lifetime.

S-BUF-1 Dimension and stride math:
Look for width/height/stride/plane/sample/array/buffer-size calculations, `CheckedNumeric`, `base::span`, `SkImageInfo`, `gfx::Size`, `WTF::Vector`.
Invariant: attacker-controlled dimensions cannot overflow allocation size or produce mismatched validated size vs consumed size.

S-BUF-2 IPC/GPU command validation:
Look for Mojo validators, command buffer decoders, Dawn/ANGLE descriptor validation, SharedImage mailbox import/export, Skia raster buffers.
Invariant: renderer-provided handles/descriptors must be validated before any native/backend access and must remain valid across async use.

S-STATE-1 State-machine transitions:
Look for navigation, frame lifecycle, permission, MHTML load/serialize, media pipeline start/stop, WebRTC renegotiation.
Invariant: callbacks from old state must not mutate or dereference new/replaced state.

S-TYPE-1 Union and downcast validation:
Look for WebIDL union handling, `To<>()`, `DynamicTo`, `static_cast`, enum-to-class dispatch, `CHECK` assumptions after earlier validation.
Invariant: the concrete type used by the sink must be the same type proven at the boundary.

## Initial Candidates

### C001 Canvas UAF: OffscreenCanvas/ImageBitmap/HTMLCanvas transfer lifecycle

Files:
- `third_party/blink/renderer/core/html/canvas/html_canvas_element.cc`
- `third_party/blink/renderer/core/html/canvas/canvas_rendering_context.cc`
- `third_party/blink/renderer/modules/canvas/imagebitmap/image_bitmap_rendering_context.cc`
- `third_party/blink/renderer/modules/canvas/imagebitmap/*`
- `third_party/blink/renderer/platform/graphics/*`

Sinks:
- `toBlob()` async `PostTask` after `Snapshot(kBackBuffer)`.
- `transferControlToOffscreen()` / placeholder canvas resource handoff.
- `transferToImageBitmap()` / `transferFromImageBitmap()` detachment.
- `Dispose()` / `Stop()` and layer/resource provider destruction.

Hypotheses:
- H1 callback-after-dispose: `toBlob()` or `createImageBitmap()` captures image/resource state, then canvas/context is detached, transferred, GC'd, or navigated before callback.
- H2 placeholder stale frame: OffscreenCanvas placeholder updates race with HTMLCanvasElement resize/dispose/frame finalization.
- H3 imagebitmap detach confusion: transferred/detached ImageBitmap is accepted by a later canvas path that assumes live backing image/layer.

### C002 ANGLE/Dawn/Tint validation bypass: descriptor accepted, backend assumes stronger invariant

Files:
- `third_party/angle/src/libANGLE`
- `third_party/dawn/src/dawn/native`
- `third_party/dawn/src/tint`
- `gpu/command_buffer/service`

Sinks:
- buffer/texture size math,
- shader WGSL/Tint validation,
- command decoder backend dispatch,
- SharedImage/texture mailbox import.

Hypotheses:
- H1 integer overflow in dimensions/levels/layers/strides before backend allocation.
- H2 validation accepts descriptor state later considered impossible by backend cast/switch.
- H3 resource destroyed on one queue/context while backend task still uses it.

### C003 Media/WebRTC/Codecs lifetime and buffer math

Files:
- `media/`
- `third_party/webrtc/`
- Blink media modules under `third_party/blink/renderer/modules`

Sinks:
- decoder output callbacks,
- `VideoFrame`/`AudioBuffer` plane size,
- WebRTC packet/frame queues,
- track stop/reconfigure/destroy.

Hypotheses:
- H1 stopped/reconfigured decoder invokes stale callback with old owner.
- H2 frame dimension/stride overflow creates smaller allocation than copy/read expects.
- H3 WebRTC renegotiation/track stop races queued decode/render.

### C004 Navigation/MHTML race

Files:
- `content/browser/renderer_host`
- `content/browser/navigation*`
- MHTML serializer/loader code.

Sinks:
- frame navigation state,
- archive parsing/serialization callbacks,
- old RenderFrameHost vs new document transitions.

Hypotheses:
- H1 MHTML load/serialize completes after frame/document replacement.
- H2 same-document/history/navigation race leaves stale policy/security state.
- H3 callback from old RFH mutates new RFH-owned object.

### C005 Accessibility/Views UAF

Files:
- `ui/accessibility`
- `ui/views`
- Blink accessibility bridge.

Sinks:
- AX tree updates,
- event dispatch,
- widget/view destruction,
- cross-process accessibility snapshot/update.

Hypotheses:
- H1 AX update callback targets node/view after DOM or widget destruction.
- H2 Views close/destroy path leaves observer registered.
- H3 accessibility tree serialization references stale renderer object during navigation.

### C006 AnimationTrigger live collection mutation

Source:
- stable patch range `147.0.7727.136..147.0.7727.137`
- commit `1c93fde36884ca2474c0abdc5590cbcbcf1ab8dc`

Files:
- `third_party/blink/renderer/core/animation/animation_trigger.cc`
- `third_party/blink/renderer/core/animation/timeline_trigger.cc`
- `third_party/blink/renderer/core/animation/animation.cc`
- `third_party/blink/renderer/core/animation/scroll_snapshot_timeline.cc`
- `third_party/blink/renderer/core/animation/document_animations.cc`

Sinks:
- live `HeapHashMap` iteration in `AnimationTrigger::PerformActivate()`
- live `HeapHashMap` iteration in `AnimationTrigger::PerformDeactivate()`
- still-suspicious live iteration in `UpdateCompositorTriggerAnimations()`
- post-update live `BehaviorMap()` iteration in
  `ScrollSnapshotTimeline::UpdateSnapshotInternal()`
- animation lifecycle paths that can disassociate triggers during update
- attachment code already snapshots named trigger attachments before removal,
  proving this subsystem has a known copy-before-mutating invariant

Hypotheses:
- H1 activation mutates `animation_behavior_map_` while iterating.
- H2 deactivation mutates `animation_behavior_map_` while iterating.
- H3 compositor trigger update has the same no-snapshot pattern.
- H4 snapshot timeline validates an animation and mutates trigger membership
  while iterating `BehaviorMap()`.

### C007 Tint MSL bool vector layout mismatch

Source:
- stable patch range `147.0.7727.136..147.0.7727.137`
- Chromium Dawn roll `68ba233a543d25e75c30f1228dd3bafa2da96937`
- Dawn commit `049880d58d6636a819168c00f44f8a4ed1e33e51`

Files:
- `third_party/dawn/src/tint/lang/msl/writer/raise/fix_type_layout.cc`

Sinks:
- WGSL -> Tint IR -> MSL layout rewrite
- `array<vec3<bool>>` physical element type lowering
- packed vec3 array element struct generation
- `LoadVectorElement` / `StoreVectorElement` scalar conversion paths
- whole array/struct load-store helper generation
- pointer-parameter rewrite loop, separate from module variable rewrite loop

Hypotheses:
- H1 nested `array<vec3<bool>>` or struct-contained arrays still compute layout
  from logical bool instead of physical `u32`.
- H2 whole nested array load/store helper misses bool `u32` conversion.
- H3 struct containing `array<vec3<bool>>` rewrites type but not access index.
- H4 `array<struct { vec3<bool> }>` bypasses direct array-element wrapper check.
- H5 pointer parameter rewrite diverges from module variable rewrite.

### C008 Viz hit-test hierarchy validation

Source:
- stable patch range `147.0.7727.136..147.0.7727.137`
- Chromium commit `97dd88c8e2f9a04b55e4644e521c1d3b6e138c2e`
- original commit `00116e7002fb40c113daaff72864bbe00590e28b`

Files:
- `components/viz/service/hit_test/hit_test_aggregator.cc`
- `components/viz/service/hit_test/hit_test_manager.cc`
- `components/viz/service/frame_sinks/frame_sink_manager_impl.cc`
- `components/viz/service/hit_test/hit_test_aggregator_unittest.cc`

Sinks:
- renderer/compositor-client supplied `HitTestRegionList`
- trusted Viz `FrameSinkId` hierarchy
- async gap between hit-test submit and aggregation
- `client_id()==0` frame sink remap during submit validation
- input routing / targeting data sent to Viz host

Hypotheses:
- H1 stale invalid region list becomes valid after hierarchy mutation without a
  fresh compositor frame.
- H2 invalid first region suppresses later valid child regions.
- H3 zero-client-id remap lets same-client sibling sink ids bypass intent.
- H4 enabled-by-default feature flag can reopen the security primitive until
  validation is unconditional.

### C009 Pseudo-element event target lifetime

Source:
- stable patch range `147.0.7727.136..147.0.7727.137`
- Chromium commit `95def1bd07956197f249712a35070ca3efda7d84`
- original commit `82777e870bf03d3d0f5fa21dad8a9311a8a69d5b`

Files:
- `third_party/blink/renderer/core/dom/pseudo_element.cc`
- `third_party/blink/renderer/core/input/event_handler.h`
- `third_party/blink/renderer/core/input/mouse_event_manager.cc`
- `third_party/blink/renderer/core/input/pointer_event_manager.cc`
- `third_party/blink/renderer/core/events/pointer_event_factory.cc`
- `third_party/blink/renderer/core/input/touch_event_manager.cc`

Sinks:
- cached `mousedown_element_`, `mouse_press_node_`, `element_under_mouse_`
- cached `element_under_pointer_`, pointer capture maps
- `PointerEventFactory` pointerdown/pointerup click target caches
- active touch target map
- `PseudoElement::Dispose()` ordering before parent/originating element is lost

Hypotheses:
- H1 `::before`/`::after` removed during pointerdown leaves stale click target.
- H2 pointer capture target points at removed pseudo across pointerup.
- H3 touchstart removes pseudo and stale touch/pointer state is used for tap
  click.
- H4 nested pseudo removal rewrites to immediate pseudo parent instead of
  ultimate originating element.
- H5 normal subtree removal plus pseudo disposal creates callback ordering not
  covered by direct pseudo removal.

### C010 HelpBubbleFactoryRegistry live iteration

Source:
- stable patch range `147.0.7727.136..147.0.7727.137`
- Chromium commit `22fcaa0ec583c8a27c3bf55c78f0883ab9b39911`

Files:
- `components/user_education/common/help_bubble/help_bubble_factory_registry.cc`
- `components/user_education/common/help_bubble/help_bubble.cc`
- `components/user_education/views/help_bubble_views.cc`
- `components/user_education/common/feature_promo/impl/feature_promo_controller_impl.cc`
- `components/user_education/common/tutorial/tutorial_service.cc`

Sinks:
- `HelpBubbleFactoryRegistry::NotifyAnchorBoundsChanged()` live map iteration
  with virtual `HelpBubble::OnAnchorBoundsChanged()` calls
- `HelpBubbleFactoryRegistry::ToggleFocusForAccessibility()` live map iteration
  with virtual `ToggleFocusForAccessibility()` calls
- `AddHelpBubble()` registers an `AddOnClosingCallback()` that erases the same
  map
- registry destructor already unsubscribes before `Close()` to avoid mutation
  while iterating, proving this mutation class is recognized locally
- upper controllers still use `base::Unretained(this)` in closed/user-action
  callbacks but appear to rely on subscription/member destruction ordering

Hypotheses:
- H1 `OnAnchorBoundsChanged()` closes the current bubble; the closing callback
  erases the current map entry and the range-for resumes with an invalidated
  iterator.
- H2 `ToggleFocusForAccessibility()` closes the current bubble and returns
  false; the registry continues iterating after current-entry erase.
- H3 external/custom help bubbles added through public `AddHelpBubble()` can
  trigger the same registry mutation without the standard factory path.
- H4 controller teardown with `base::Unretained(this)` callbacks remains safe
  only because subscriptions are destroyed before owned bubbles; any reordered
  field or manual `OnDestroying()` path could reintroduce UAF.

### C011 Viz transition directive reentry

Source:
- CVE-2026-7357 / issue `497047552`
- main CL `7717958`: `OnSaveTransitionDirectiveProcessed` reentry UAF

Files:
- `components/viz/service/frame_sinks/compositor_frame_sink_support.cc`
- `components/viz/service/frame_sinks/compositor_frame_sink_support_unittest.cc`
- adjacent Viz transition/surface manager code paths

Sinks:
- `client_->OnCompositorFrameTransitionDirectiveProcessed()`
- `FrameSinkManagerImpl::CacheSurfaceAnimationManager()`
- `view_transition_token_to_animation_manager_`
- pending frame activation that processes new transition directives

Hypotheses:
- H1 client ack callback destroys or mutates `CompositorFrameSinkSupport`, and
  later code still uses `this` or map entries.
- H2 cross-frame-sink save completion activates a pending frame that inserts
  many transition managers, invalidating the iterator/reference captured before
  callback.
- H3 non-cross-frame-sink or duplicate sequence-id path has a similar reentry
  window but was not covered by the original cross-frame-sink regression test.
- H4 cleanup paths for abandoned/failed transitions use the same token map but
  were not hardened by the save-completion fix.

### C012 SurfaceManager allocation-group vector mutation

Source:
- same family as CVE-2026-7333 / issue `493955227`, CL `7707244`
- public patch copies `frame_sink_id_to_allocation_groups_[frame_sink_id]` before
  iterating because allocation-group operations can mutate the live vector.
- this is a sibling of Surface GC reentry, but the exact fixed sink is
  allocation-group iteration invalidation, not generic `surfaces_to_destroy_`
  mutation.

Files:
- `components/viz/service/surfaces/surface_manager.cc`
- `components/viz/service/surfaces/surface_allocation_group.cc`
- `components/viz/service/surfaces/surface.cc`
- `components/viz/service/surfaces/surface_unittest.cc`

Sinks:
- `GarbageCollectSurfacesForFrameSinkId()`
- `frame_sink_id_to_allocation_groups_`
- `SurfaceAllocationGroup` temporary/reference updates
- `DestroySurfaceInternal()`
- `surfaces_to_destroy_`
- `surface_map_`
- surface draw callbacks / observer notifications

Hypotheses:
- H1 public regression replay: iterating allocation groups for a `FrameSinkId`
  triggers live-vector mutation and stale iterator/reference use on unpatched
  code.
- H2 sibling loop search: any other loop over `frame_sink_id_to_allocation_groups_`
  or group-owned vectors calls into group methods that can erase/insert groups
  without snapshotting first.
- H3 allocation group GC and surface GC interleave, leaving a live `SurfaceId`
  reachable in one structure and destroyed in another.
- H4 destructor/draw callback mutates references while root/temporary references
  are being removed, producing double destroy or stale observer callback.

### C013 Fullscreen exit during cross-document navigation

Source:
- CVE-2026-7356 / issue `497769116`
- main CL `7750093`

Files:
- `content/browser/renderer_host/navigator.cc`
- `content/browser/web_contents/web_contents_impl.cc`
- adjacent fullscreen and navigation commit code

Sinks:
- fullscreen exit callbacks during navigation commit
- `WebContentsImpl` mutation/destruction
- `Navigator` / `RenderFrameHostImpl` replacement

Hypotheses:
- H1 fullscreen exit dispatch during cross-document navigation destroys or
  replaces WebContents state before navigation code resumes.
- H2 nested navigation from fullscreen-exit observer leaves stale RFH or policy
  state in the committing navigation.
- H3 same-document vs cross-document branch diverges in liveness checks.

### C014 MHTML pending document RFH race

Source:
- CVE-2026-7351 / issue `499119490`
- main CL `7762708`

Files:
- `content/browser/download/mhtml_generation_manager.cc`
- nearby MHTML serializer and download plumbing

Sinks:
- pending document map/list
- `RenderFrameHostImpl` pointers
- MHTML generation completion callbacks

Hypotheses:
- H1 pending document stores an RFH that is swapped by navigation before MHTML
  generation completion.
- H2 cancellation and completion race leaves the pending entry alive after RFH
  teardown.
- H3 multi-frame MHTML generation removes one RFH while another completion path
  still assumes the original frame tree.

### C015 WebMIDI manager cross-thread lifetime

Source:
- CVE-2026-7350 / issue `500018484`
- main CL `7737022`

Files:
- `media/midi/midi_manager.cc`
- `media/midi/midi_manager_win.cc`
- `media/midi/midi_manager_unittest.cc`

Sinks:
- `pending_clients_`
- `clients_`
- session thread runner callbacks
- platform MIDI manager teardown

Hypotheses:
- H1 client removal races initialization completion, moving a stale client from
  pending to active after disconnect.
- H2 platform callback after `MidiManager` destruction dereferences session
  thread state.
- H3 duplicate client start/stop crosses pending/active sets with mismatched
  release-build checks.

### C016 Media remoting duplicate acquire

Source:
- CVE-2026-7349 / issue `500034684`
- main CL `7748690`

Files:
- `media/remoting/stream_provider.cc`
- `media/remoting/stream_provider_unittest.cc`

Sinks:
- `RPC_ACQUIRE_DEMUXER`
- `receiver_controller_`
- `rpc_messenger_`
- stream provider `Initialize()` / `OnReceivedRpc()`

Hypotheses:
- H1 duplicate `RPC_ACQUIRE_DEMUXER` creates or binds a demuxer twice and leaves
  one provider path with stale callbacks.
- H2 media/main task runner handoff processes acquire after teardown.
- H3 audio/video dual stream state lets one stream close while duplicate acquire
  mutates shared provider state.

### C017 Blink ImageDecodingStore lifetime

Source:
- CVE-2026-7348 / issue `500104917`
- main CL `7736761`

Files:
- `third_party/blink/renderer/platform/graphics/image_decoding_store.cc`
- `third_party/blink/renderer/platform/graphics/image_decoding_store_test.cc`
- adjacent image decoder/cache code

Sinks:
- decode completion callbacks
- cache eviction
- keyed image decode store entries
- deferred/async image decode tasks

Hypotheses:
- H1 decode completes after store entry eviction and reuses stale image data.
- H2 duplicate decode key reuses an entry whose owner image changed or was GC'd.
- H3 shutdown/GC drains store while queued decode completion still has a raw
  entry pointer.

### C018 JPEG scale precision / dimension invariant

Source:
- CVE-2026-7348 related CL `7742306`

Files:
- `third_party/blink/renderer/platform/image-decoders/jpeg/jpeg_image_decoder.cc`
- JPEG decoder tests

Sinks:
- desired scale numerator/denominator
- decoded output dimensions
- allocation and copy size for scaled decode

Hypotheses:
- H1 integer precision loss picks a smaller scale/output allocation than the
  JPEG decoder later writes.
- H2 extreme dimensions across progressive/incremental decode diverge from the
  validation path tested by the patch.

### C019 SourceBufferStream GC bookkeeping

Source:
- CVE-2026-7335 / issue `500387779`
- CVE-2026-7355 / issue `498285711`
- main CLs `7737855`, `7719308`

Files:
- `media/filters/source_buffer_stream.cc`
- `media/filters/source_buffer_stream_unittest.cc`

Sinks:
- `range_for_next_append_`
- `ranges_`
- `selected_range_`
- SourceBuffer garbage collection
- release `CHECK` promotions replacing previous debug-only assumptions

Hypotheses:
- H1 GC removes the range tracked by `range_for_next_append_`, then append uses
  a stale iterator/range.
- H2 seek/append/remove ordering leaves `selected_range_` valid but
  `range_for_next_append_` stale.
- H3 another debug-only range invariant near the patched checks is reachable
  from adversarial MSE segment sequences in release.

### C020 WebRTC/Chromoting renderer adapter lifetime

Source:
- CVE-2026-7347 / issue `501722605`
- main CL `7757703`

Files:
- `remoting/protocol/webrtc_video_renderer_adapter.cc`
- `remoting/protocol/webrtc_video_renderer_adapter.h`
- adapter unittest

Sinks:
- WebRTC video sink callbacks
- renderer adapter task runner
- stats queues keyed by RTP timestamp
- media stream / track teardown

Hypotheses:
- H1 WebRTC sink callback arrives after adapter destruction.
- H2 stats queue assumes monotonically paired host/client timestamp entries and
  release path can desynchronize them.
- H3 track removal/re-addition with same label causes stale adapter callback.

### C021 WebView JS binding lifetime

Source:
- CVE-2026-7342 / issue `503889643`
- main CL `7780011`

Files:
- `components/js_injection/renderer/js_binding.cc`
- `components/js_injection/renderer/js_binding.h`

Sinks:
- V8/JS callbacks into native binding
- frame/context teardown
- binding object lifetime across injection/removal

Hypotheses:
- H1 JS callback executes after frame/context teardown and dereferences native
  binding state.
- H2 reinjection with same binding name lets old callback target a new native
  object with stale assumptions.

### C022 RTCEncodedVideoStreamTransformerDelegate cross-thread lifetime

Source:
- CVE-2026-7341 / issue `504586599`
- main CL `7779865`

Files:
- `third_party/blink/renderer/platform/peerconnection/rtc_encoded_video_stream_transformer.cc`
- corresponding transformer tests

Sinks:
- encoded frame callbacks
- Blink task runner / WebRTC task runner boundary
- delegate owner teardown

Hypotheses:
- H1 encoded frame transform callback runs after delegate owner destruction.
- H2 shutdown cancels one task queue but another queue still holds a raw
  delegate or callback.
- H3 reconfigure/replaceTrack leaves old transformer alive with new stream
  assumptions.

### C023 WebRTC audio processor release invariant

Source:
- CVE-2026-7339 / issue `493957495`
- main CL `7710554`

Files:
- `media/webrtc/audio_processor.cc`

Sinks:
- audio frame size/channel checks
- capture/render buffer conversion
- `ProcessStream()` and processed audio delivery

Hypotheses:
- H1 attacker-reachable audio format mismatch previously only hit `DCHECK_EQ`;
  release build then copied/processes with mismatched channels or frame count.
- H2 nearby debug-only audio buffer invariants remain release-unchecked and can
  become heap overflow with crafted WebRTC audio parameters.

### C024 ANGLE numeric validation

Source:
- CVE-2026-7354 / issue `498746519`, ANGLE CL `7774827`
- CVE-2026-7340 / issue `497896137`, ANGLE CL `7728091`

Files:
- `third_party/angle/src/libANGLE/renderer/vulkan/VertexArrayVk.cpp`
- `third_party/angle/src/libANGLE/renderer/d3d/TextureD3D.cpp`
- ANGLE GL tests for vertex attributes and BPTC compressed textures

Sinks:
- max index calculation for GPU-side index conversion
- compressed 3D texture block count / allocation size
- backend-specific unchecked arithmetic after frontend validation

Hypotheses:
- H1 Vulkan max-index path validates one index width but converts with another.
- H2 compressed 3D dimensions overflow in layer/depth multiplication outside
  the exact patched BPTC path.
- H3 frontend validation accepts zero/edge dimensions that backend normalizes
  differently before allocation.

### C025 V8 Maglev Smi check elision variants

Source:
- CVE-2026-7337 / issue `500880819`
- V8 CL `7761542`

Files:
- `v8/src/maglev/maglev-graph-builder.cc`
- `v8/src/maglev/maglev-reducer-inl.h`
- `v8/src/maglev/maglev-graph-optimizer.cc`
- `v8/src/maglev/maglev-phi-representation-selector.cc`

Sinks:
- `BuildCheckSmi()`
- `TryGetConstantAlternative()`
- `TryGetInt32Constant()` / `TryGetFloat64OrHoleyFloat64Constant()`
- check-elision visitors for `CheckInt32IsSmi`, `CheckUint32IsSmi`,
  `CheckFloat64IsSmi`, `CheckedSmiSizedInt32`

Hypotheses:
- H1 another check-elision visitor uses `TryGet*Constant()` on a tagged input
  where value equivalence does not imply representation/tag equivalence.
- H2 phi representation rewriting converts `CheckSmi` to non-tagged checks
  without preserving the "tagged input still needs tag-bit check" invariant.
- H3 `TryGetConstantAlternative()` exposes HeapNumber-derived constants to
  paths that later assume Smi-tagged values.
- H4 `AllowWideningSmiToInt32` creates a path where type feedback proves number
  value but not Smi representation.

## Priority

Start with C001 because it maps directly to a Critical externally rewarded UAF and is web-triggerable from normal renderer APIs. Move to C002 next because ANGLE/Dawn/Tint gives three accepted classes in one boundary: UAF, OOB/integer overflow, and inappropriate implementation.

Patch-diff update: C006 becomes the first range-derived probe because the fix is
small and directly exposes a Blink collection mutation invariant. C007 is next
GPU/Tint probe because it maps to a real stable roll and an "inappropriate
implementation" class. C008 is the strongest first-range browser-process
integrity probe because the fix maps directly to CVE-2026-7360 and trusted Viz
hierarchy validation. After source refinement, C008 needs a real `IsChildOf()`
bypass to stay high priority. C009 becomes the next Blink lifetime probe because
the patch touched Mouse/Pointer/Touch caches and pseudo-element disposal order.
C010 is a same-patch variant of the HelpBubble teardown hardening and should be
validated with a focused `components_unittests` gtest before spending more time
on weaker UI-only callback paths.

Patch-url expansion update: after mapping every public CL from the April 28
Chrome 147 post, the next first-phase order is:

1. C011/C012/C010/C006: reentry UAF cluster with direct regression tests or
   live-iteration sinks already visible in source.
2. C019/C023: release-invariant upgrades where `DCHECK`-only assumptions became
   security-significant `CHECK`s.
3. C025: V8 Maglev variant of the accepted type-confusion class.
4. C024/C018: numeric/OOB GPU/media validation.
5. C013/C014/C015/C016/C020/C021/C022: async lifetime surfaces after the first
   reentry cluster has either yielded or been refuted.
