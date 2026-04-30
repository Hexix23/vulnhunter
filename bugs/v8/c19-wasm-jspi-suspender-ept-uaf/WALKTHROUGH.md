# C19 walkthrough

Set up Linux OrbStack VM because V8 sandbox crash filtering is Linux-only. A non-sandbox Linux d8 accepted `--sandbox-testing` but did not expose `Sandbox`; root cause was missing GN flags.

Working build:

```text
out/sandbox_dcheck_linux
v8_enable_sandbox=true
v8_enable_memory_corruption_api=true
v8_enable_test_features=true
dcheck_always_on=true
v8_enable_verify_heap=true
```

Validated:

```text
typeof Sandbox == object
typeof Sandbox.getAddressOf == function
typeof Sandbox.getObjectAt == function
```

Ran upstream `test/mjsunit/sandbox/regress-501147587.js`. On this fixed tree it exits with a harmless null dereference, not a UAF. This proves Linux sandbox infra is now usable and that the known C19 seed is patched here.

Follow-up variants:

- H2 swapped termination for normal JS throw after JSPI resume. Refuted.
- H3 used nested suspenders and manually resumed the outer stale callback after termination. Refuted.
- H4 used nested suspenders and manually resumed the inner stale callback after termination. Refuted.

Next hunt should not re-test exact stale JSPI resume shape. Use the same Linux sandbox build for other sandbox seeds or move back to C20 shared-memory growth variants.
