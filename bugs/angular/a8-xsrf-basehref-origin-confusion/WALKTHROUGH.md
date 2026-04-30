# Walkthrough

## Sink

`packages/common/http/src/xsrf.ts`:

```ts
const locationHref = inject(PlatformLocation).href;
const {origin: locationOrigin} = new URL(locationHref);
const {origin: requestOrigin} = new URL(req.url, locationOrigin);
```

The security decision is whether to attach the XSRF header to a mutating request.

## Hypothesis

If browser request URL resolution uses `document.baseURI`, but Angular's XSRF decision uses only
`location.origin`, a cross-origin `<base href>` can split the decision from the actual network
target.

## Tests

1. Browser probe with Chrome headless:
   - page origin: `http://127.0.0.1:8124`
   - base href: `http://127.0.0.1:8123/evil/`
   - `fetch('api')`, `fetch('/root-api')`, XHR equivalents
   - result: all requests reached `127.0.0.1:8123`.

2. Angular framework probe:
   - added temporary `xsrf_spec.ts` test for `api`, `/api`, `./api`, `../api`
   - result: all received `X-XSRF-TOKEN`.

## Verdict

Confirmed parser/URL-base mismatch between the framework XSRF decision and browser network
resolution. Chain-required because cross-origin base href must be attacker-controlled or
misconfigured.

