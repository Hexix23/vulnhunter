# C007 Verdict

Status: IN PROGRESS

Confirmed:
- Chrome stable update lists CVE-2026-7346 as high severity inappropriate
  implementation in Tint.
- The stable diff contains a narrow fix for MSL `FixTypeLayout` handling of
  `array<vec3<bool>>`.
- Local source shows only one new direct regression shape: array of vec3 bool
  with vector element load.

Not yet confirmed:
- No variant crash, shader miscompile, out-of-bounds access, or validation
  divergence demonstrated yet.
- No VRP-grade report exists from this branch until one PoC produces a bad MSL
  lowering, bad IR transform, GPU process crash, or observable WebGPU
  misbehavior in a patched/near-tip build.
- Focused build attempt timed out after 180s with no leftover processes; see
  `evidence/build-timeout.txt`.

Priority gates:
1. Add focused `MslWriter_FixTypeLayoutTest` variants for H1-H5.
2. Run only the Tint MSL writer raise unit target.
3. If any test produces wrong IR/MSL, reduce to WGSL and then to a WebGPU page.
4. If no wrong lowering, close C007 as patched-family covered and pivot to the
   next high-signal diff commit.
