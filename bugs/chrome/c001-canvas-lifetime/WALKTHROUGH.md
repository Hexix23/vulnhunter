# C001 Canvas Lifetime Walkthrough

Goal: probe Critical-class Canvas UAF patterns from the Chrome 147.0.7727.137/138 release without relying on bug details.

Source files first touched:
- `third_party/blink/renderer/core/html/canvas/canvas_rendering_context.{h,cc}`
- `third_party/blink/renderer/core/html/canvas/html_canvas_element.{h,cc}`
- `third_party/blink/renderer/modules/canvas/imagebitmap/image_bitmap_rendering_context.{h,cc}`
- `third_party/blink/renderer/modules/canvas/imagebitmap/*`
- `third_party/blink/renderer/platform/graphics/*`

Initial sink grep found:
- `CanvasRenderingContext` has a pre-finalizer `Dispose()`, virtual `Stop()`, `PreFinalizeFrame()`, `FinalizeFrame()`, and OffscreenCanvas-specific `TransferToImageBitmap()`.
- `HTMLCanvasElement::Dispose()` at `html_canvas_element.cc:403-417` unregisters placeholder state, nulls `frame_dispatcher_`, discards resources, detaches the context host, then clears `context_`.
- `HTMLCanvasElement::PostFinalizeFrame()` at `html_canvas_element.cc:766-800` can dispatch a low-latency frame via `frame_dispatcher_`, notify listeners, and switch caches after rendering results are painted to a resource.
- `HTMLCanvasElement::toBlob()` at `html_canvas_element.cc:1387-1448` takes a `Snapshot(kBackBuffer)`, constructs `CanvasAsyncBlobCreator`, and schedules async blob creation. Empty/non-paintable paths post a callback task using `WrapPersistent(callback)`.
- `HTMLCanvasElement::CreateImageBitmap()` at `html_canvas_element.cc:1942-1955` creates an `ImageBitmap` over `this` through `ImageBitmapSource::FulfillImageBitmap`.
- `HTMLCanvasElement::SetOffscreenCanvasResource()` at `html_canvas_element.cc:1958-1963` moves an `ExportedCanvasResource`, then immediately reads `OffscreenCanvasFrame()->Size()` and notifies listeners.
- `ImageBitmapRenderingContext::Stop()` at `image_bitmap_rendering_context.cc:72-74` disposes `image_layer_bridge_`; `Dispose()` at `:82-85` calls `Stop()`, resets resource provider, then base dispose.
- `ImageBitmapRenderingContext::SetImage()` at `:102-119` validates `!IsNeutered()` only with DCHECK, sets bridge image, then closes the `ImageBitmap`.
- `ImageBitmapRenderingContext::transferFromImageBitmap()` at `:254-269` rejects neutered input before calling `SetImage()`.
- `ImageBitmapRenderingContext::TransferToImageBitmap()` at `:271-279` gets and resets the internal image, calls `image->Transfer()`, then wraps it in a new `ImageBitmap`.
- `ImageBitmapRenderingContext::PushFrame()` at `image_bitmap_rendering_context.cc:157-225` is OffscreenCanvas-only, pulls `image_layer_bridge_->GetImage()`, recreates `resource_provider_for_offscreen_canvas_` on size mismatch, handles invalid GPU provider, and calls `Host()->DidDraw()`. This is a good H2 sink because it combines image lifetime, provider lifetime, GPU validity, and placeholder state.
- `CanvasAsyncBlobCreator` stores `image_`, `context_`, raw pixmap state, parent task runner, callback/resolver at `canvas_async_blob_creator.h:95-123`.
- `CanvasAsyncBlobCreator::Dispose()` at `canvas_async_blob_creator.cc:223-232` explicitly clears context/callback/resolver/image/skia state to avoid retention while already-posted tasks remain queued.
- `CanvasAsyncBlobCreator::ScheduleAsyncBlobCreation()` at `canvas_async_blob_creator.cc:274-343` chooses direct worker-thread encoding, background worker-pool encoding, or main-thread idle encoding. It posts `WrapPersistent(this)` tasks and uses `MakeCrossThreadHandle(this)` for off-thread encoding.
- `CanvasAsyncBlobCreator::CreateBlobAndReturnResult()` at `canvas_async_blob_creator.cc:431-455` posts the JS callback/resolver result, records metrics using `image_->width()/height()`, then calls `Dispose()`.
- `CanvasAsyncBlobCreator::EncodeImageOnEncoderThread()` at `canvas_async_blob_creator.cc:482-508` keeps `skia_image` alive because `ImageDataBuffer` contains raw pointers into it, then posts back via `MakeUnwrappingCrossThreadHandle`.

First hypotheses:
- H1: async `toBlob()` or `createImageBitmap()` completion after canvas/context disposal, transfer, GC, or navigation.
- H2: OffscreenCanvas placeholder frame/resource update racing HTMLCanvasElement resize/dispose/finalize.
- H3: ImageBitmap detached/transfer state is validated at one entry point but later consumed by snapshot/paint path that assumes live backing.

Status: source inventory started. No PoC verdict yet.

Next concrete probes:
- H1 JS harness: `canvas.toBlob(cb)`, then resize-to-zero/DOM removal/navigation/GC before callback; compare ASAN content_shell vs release.
- H2 JS harness: OffscreenCanvas in worker repeatedly `transferToImageBitmap()`, main thread `bitmaprenderer.transferFromImageBitmap()`, resize/remove placeholder during frame finalize.
- H3 JS harness: repeated `bitmaprenderer.transferFromImageBitmap(bitmap)` with detached/reused `ImageBitmap`, then snapshot/draw/resize/GC pressure to detect stale backing image use.
- H4 JS harness: worker `OffscreenCanvas.convertToBlob({type:"image/webp"})`, then terminate worker immediately after encode starts to stress post-back after worker context teardown.

Refinement after reading async creator:
- A naive remove-after-`toBlob()` is probably protected by the creator retaining `StaticBitmapImage` and callback/resolver as GC members.
- More interesting H1 variants must force ordering around already-posted timeout/idle/cross-thread tasks after `Dispose()`, especially WebP/background encoding and PNG/JPEG idle fallback paths.
- The raw pointer sink is `src_data_` holding pixels owned by `skia_image_`; off-thread path intentionally captures `skia_image`, so a bug would need a path where `src_data_` survives without matching image lifetime or where post-back unwrap runs after context teardown.

Existing protective tests found:
- `CanvasRenderingContext2DTest.CanvasDisposedBeforeContext` at `canvas_rendering_context_2d_test.cc:1518-1530` covers `DetachHost()` followed by a task observer callback.
- `CanvasRenderingContext2DTest.ContextDisposedBeforeCanvas` at `:1532-1537` covers `DetachContext()` during teardown.
- `CanvasAsyncBlobCreatorTest` only mocks idle timeout state transitions (`canvas_async_blob_creator_test.cc:187-231`); it does not directly cover document/worker destruction during real WebP/background encode post-back.
