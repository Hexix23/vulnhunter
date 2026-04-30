# Evidence - Angular TransferCache key confusion

Date: 2026-04-28

Target checkout:

```text
/Users/carlosgomez/OrbStack/angularvm/home/carlosgomez/angular
```

Test command:

```bash
orb -m ubuntu -u root chroot --userspec=carlosgomez:carlosgomez /mnt/machines/angularvm /usr/bin/env HOME=/home/carlosgomez USER=carlosgomez LOGNAME=carlosgomez PATH=/usr/local/bin:/usr/bin:/bin:/opt/node-v22.22.2/bin pnpm --dir /home/carlosgomez/angular exec bazelisk test //packages/common/http/test:test --test_filter='TransferCache should expose transfer cache key confusion'
```

Result:

```text
INFO: Build completed successfully, 4 total actions
//packages/common/http/test:test                                         PASSED in 1.8s

Executed 1 out of 1 test: 1 test passes.
```

Probe expectations that passed:

```text
POST /api|x body y      -> cache stores "first-response"
POST /api body x|y      -> backend not hit; receives "first-response"

GET /query?a=1,2        -> cache stores "single-comma"
GET /query?a=1&a=2      -> backend not hit; receives "single-comma"

SSR server GET /query?a=1,2      -> TransferState stores "server-response"
hydrated browser GET /query?a=1&a=2 -> backend not hit; receives "server-response"
```

Refuted side path:

```text
URLSearchParams body multiplicity did not collide through the real interceptor path.
The second request hit the backend, so that body-specific branch is not a confirmed exploit path.
```

Standalone SSR app validation:

```text
Fixture:
/home/carlosgomez/angular/integration/platform-server/projects/standalone

Temporary app-level probe:
- /api returned different JSON for repeated query values vs comma-containing values.
- http-transferstate-lazy component made both requests through real HttpClient.

OrbStack linux/arm64 blocker:
The integration target fails before execution because rules_browsers Chromium has no matching
linux_arm64 condition.

macOS validation:
Running the same integration target on macOS arm64 built the standalone SSR app, started the
server on port 4206, and ran Chrome/Protractor. The E2E output showed the server-side DOM receiving
distinct comma-vs-multi responses, then the hydrated browser state reading the overwritten
multi-value response from TransferState.

Detailed evidence:
bugs/angular/a7-transfer-cache-key-confusion/evidence/2026-04-28-macos-standalone-ssr-e2e.md
```
