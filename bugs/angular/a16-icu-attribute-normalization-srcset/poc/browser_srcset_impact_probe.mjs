import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const evidenceDir = resolve(here, '../evidence');
mkdirSync(evidenceDir, {recursive: true});

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profileDir = mkdtempSync(resolve(tmpdir(), 'angular-a16-chrome-profile-'));
const requests = [];

const page = (port) => `<!doctype html>
<meta charset="utf-8">
<body>
  <picture id="picture-source">
    <source srcset="http://127.0.0.1:${port}/source-1x.png 1x">
    <img id="picture-img" alt="picture fallback">
  </picture>
  <img id="img-srcset-js" srcset="/safe.png 1x, javascript:top.postMessage('srcset-js', '*') 2x">
  <script>
    const seen = [];
    addEventListener('message', event => {
      seen.push(String(event.data));
      fetch('/event?message=' + encodeURIComponent(String(event.data))).catch(() => {});
    });
    setTimeout(() => {
      document.body.setAttribute('data-messages', seen.join(','));
      fetch('/event?done=1&messages=' + encodeURIComponent(seen.join(','))).catch(() => {});
    }, 1000);
  </script>
</body>`;

const server = createServer((req, res) => {
  requests.push({url: req.url, headers: req.headers});
  if (req.url === '/' || req.url.startsWith('/probe.html')) {
    res.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
    res.end(page(server.address().port));
    return;
  }
  if (req.url.startsWith('/source-1x.png') || req.url.startsWith('/safe.png')) {
    res.writeHead(200, {'content-type': 'image/png'});
    res.end(Buffer.from('89504e470d0a1a0a', 'hex'));
    return;
  }
  if (req.url.startsWith('/event')) {
    res.writeHead(204);
    res.end();
    return;
  }
  res.writeHead(404);
  res.end('not found');
});

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  const child = spawn(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      `--user-data-dir=${profileDir}`,
      '--virtual-time-budget=3000',
      '--dump-dom',
      `http://127.0.0.1:${port}/probe.html`,
    ],
    {detached: true},
  );

  let stdout = '';
  let stderr = '';
  const timer = setTimeout(() => {
    stderr += '\n[probe] chrome timeout; sending SIGKILL\n';
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
    const result = {code: 'timeout', requests, stdout, stderr};
    writeFileSync(
      resolve(evidenceDir, '2026-04-29-browser-srcset-impact.json'),
      JSON.stringify(result, null, 2),
    );
    server.close();
    process.exit(requests.some((request) => request.url.startsWith('/event?done=1')) ? 0 : 1);
  }, 10000);

  child.stdout.on('data', (chunk) => (stdout += chunk));
  child.stderr.on('data', (chunk) => (stderr += chunk));
  child.on('close', (code) => {
    clearTimeout(timer);
    const result = {code, requests, stdout, stderr};
    writeFileSync(
      resolve(evidenceDir, '2026-04-29-browser-srcset-impact.json'),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify({code, requests: requests.map((r) => r.url), stdout}, null, 2));
    server.close();
    process.exit(requests.some((request) => request.url.startsWith('/event?done=1')) ? 0 : 1);
  });
});
