# C1/C2 Maglev Phi Wrong-Code Probes

Impact class: `WRONG_CODE / TYPE_CONFUSION`.

Target:

- `src/maglev/maglev-phi-representation-selector.cc`

Core risks:

- Static `Smi` / `Number` knowledge can trigger unsafe phi input untagging.
- Peeled loop backedges can be speculatively untagged.
- Retagged untagged phis must update checks, write barriers, and boolean/type
  uses correctly.

Oracle:

- baseline interpreter/reference result vs optimized Maglev result;
- optional trace with `--trace-maglev-phi-untagging`;
- release vs ASan/dcheck where useful.
