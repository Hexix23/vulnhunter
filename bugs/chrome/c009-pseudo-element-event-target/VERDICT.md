# C009 Verdict

Status: IN PROGRESS

Confirmed:
- Stable patch changed lifetime/order handling for hit-testable pseudo-element
  removal across Mouse, Pointer, Touch, and PointerEventFactory caches.
- The old bug class is broader than click dispatch only: stale targets can live
  in pointer capture and active touch maps.

Not yet confirmed:
- No local crash or security-impacting event target confusion.
- No evidence yet that the M147 fix missed nested pseudo, touch, or capture
  variants.

Priority gates:
1. Run H1-H3 in a browser/content_shell harness with
   `--enable-blink-features=PseudoElementsHitTestable`.
2. If no crash, instrument event logs to compare target/currentTarget and click
   target after pseudo removal.
3. If target confusion crosses document/frame or capture boundary, reduce for
   report. Otherwise catalog as patch family and continue.
