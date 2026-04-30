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
const requests = [];
const profileDir = mkdtempSync(resolve(tmpdir(), 'angular-a11-chrome-profile-'));

const svgWithScript = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg">
  <script>try { top.postMessage('external-svg-script-executed', '*'); } catch (e) {}</script>
  <symbol id="shape"><rect width="20" height="20" fill="red"/></symbol>
  <path id="motion" d="M0,0 L20,0"/>
</svg>`;

const page = (port) => `<!doctype html>
<meta charset="utf-8">
<body>
<svg width="200" height="200">
  <symbol id="local"><circle cx="10" cy="10" r="10"/></symbol>
  <use id="use-xlink" xlink:href="http://127.0.0.1:${port}/external.svg#shape"></use>
  <use id="use-href" href="http://127.0.0.1:${port}/external.svg#shape"></use>
  <use id="use-js" href="javascript:top.postMessage('use-js-executed','*')"></use>
  <image id="image-href" href="http://127.0.0.1:${port}/image.svg"></image>
  <image id="image-js" href="javascript:top.postMessage('image-js-executed','*')"></image>
  <animateMotion id="motion">
    <mpath href="http://127.0.0.1:${port}/mpath.svg#motion"></mpath>
  </animateMotion>
  <use id="animate-by" href="#local">
    <animate attributeName="href" by="http://127.0.0.1:${port}/external.svg#shape" dur="1ms" fill="freeze" begin="0s"></animate>
  </use>
</svg>
<script>
  const seen = [];
  addEventListener('message', (event) => {
    seen.push(String(event.data));
    fetch('/event?message=' + encodeURIComponent(String(event.data))).catch(() => {});
  });
  setTimeout(() => {
    const byHref = document.getElementById('animate-by').getAttribute('href');
    fetch('/event?finalByHref=' + encodeURIComponent(byHref || '') + '&messages=' + encodeURIComponent(seen.join(','))).catch(() => {});
    document.body.setAttribute('data-final-by-href', byHref || '');
    document.body.setAttribute('data-messages', seen.join(','));
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
  if (
    req.url.startsWith('/external.svg') ||
    req.url.startsWith('/image.svg') ||
    req.url.startsWith('/mpath.svg')
  ) {
    res.writeHead(200, {'content-type': 'image/svg+xml'});
    res.end(svgWithScript);
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

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  const child = spawn(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    `--user-data-dir=${profileDir}`,
    '--virtual-time-budget=3000',
    '--dump-dom',
    `http://127.0.0.1:${port}/probe.html`,
  ]);

  let stdout = '';
  let stderr = '';
  const timer = setTimeout(() => {
    stderr += '\n[probe] chrome timeout; sending SIGKILL\n';
    child.kill('SIGKILL');
  }, 10000);
  child.stdout.on('data', (chunk) => (stdout += chunk));
  child.stderr.on('data', (chunk) => (stderr += chunk));
  child.on('close', (code) => {
    clearTimeout(timer);
    const capturedFinalEvent = requests.some((request) =>
      request.url.startsWith('/event?finalByHref='),
    );
    const result = {code, requests, stdout, stderr};
    writeFileSync(
      resolve(evidenceDir, '2026-04-29-browser-svg-sink-impact.json'),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify({code, requests: requests.map((r) => r.url), stdout}, null, 2));
    server.close();
    process.exit(capturedFinalEvent ? 0 : (code ?? 1));
  });
});
