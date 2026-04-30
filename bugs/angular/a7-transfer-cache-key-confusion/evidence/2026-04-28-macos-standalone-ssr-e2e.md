# Evidence - macOS standalone SSR fixture

Date: 2026-04-28

Command run from macOS:

```bash
bazelisk test //integration/platform-server:test --test_output=streamed
```

Temporary fixture changes:

- `integration/platform-server/projects/standalone/server.ts`
  - `/api` returned `API comma response` for `?a=1,2`.
  - `/api` returned `API multi-value response` for `?a=1&a=2`.
- `integration/platform-server/projects/standalone/src/app/http-transferstate-lazy/http-transfer-state.component.ts`
  - Constructor request: `GET /api` with `new HttpParams({fromObject: {a: '1,2'}})`.
  - `ngOnInit` request: `GET /api` with `new HttpParams({fromObject: {a: ['1', '2']}})`.

Result:

```text
Angular CLI       : 22.0.0-next.6
Angular           : 0.0.0
Node.js           : 22.22.2
Operating System  : darwin arm64

Server listening on port 4206!
```

The standalone SSR/browser E2E test then observed:

```text
Http TransferState Lazy
  Expected 'API comma response' to be 'API 1 response'.
  Expected 'API multi-value response' to be 'API 2 response'.
  Expected 'API multi-value response' to be 'API 1 response'.
  Expected 'API multi-value response' to be 'API 2 response'.
```

Interpretation:

- The first two failures are the server-rendered DOM:
  - `.one` received `API comma response` from `/api?a=1,2`.
  - `.two` received `API multi-value response` from `/api?a=1&a=2`.
- The last two failures happen after `bootstrapClientApp()`:
  - `.one` changed to `API multi-value response`.
  - `.two` stayed `API multi-value response`.
- The existing E2E also checks that no browser resource request containing `/api` occurs after hydration.
  Since no extra `apiRequests` assertion failure was reported, the client-side values came from
  `TransferState`, not from network.

This confirms the app-level behavior behind the unit test:

1. The server can issue two distinct HTTP requests during SSR.
2. The two responses share a `TransferCache` key.
3. The later server response overwrites the earlier cached entry.
4. During browser hydration, a distinct request receives the overwritten response from cache.

The related `Http TransferState Lazy On Init` failure only confirms that the temporary `/api`
fixture returned `API comma response` instead of the original `API 1 response`; it is not needed
for the key-confusion proof.

