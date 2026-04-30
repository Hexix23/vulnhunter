const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawn} = require('child_process');

const workerPath =
  '/Users/carlosgomez/OrbStack/angularvm/home/carlosgomez/.cache/bazel/_bazel_carlosgomez/21736b10e0ce36c45ab45e0ac965bc9c/execroot/_main/bazel-out/aarch64-fastbuild/bin/packages/service-worker/ngsw-worker.js';

const PORT = 8133;
const hits = [];
let chromeProcess = null;

function body(res, status, headers, text) {
  res.writeHead(status, headers);
  res.end(text);
}

const manifest = {
  configVersion: 1,
  timestamp: Date.now(),
  index: '/index.html',
  assetGroups: [
    {
      name: 'dynamic',
      installMode: 'lazy',
      updateMode: 'lazy',
      urls: [],
      patterns: ['\\/runtime-config\\.json'],
      cacheQueryOptions: {ignoreSearch: true, ignoreVary: true},
    },
  ],
  dataGroups: [],
  hashTable: {},
  navigationUrls: [],
  navigationRequestStrategy: 'performance',
};

const server = http.createServer((req, res) => {
  hits.push(req.url);
  if (req.url === '/' || req.url.startsWith('/index.html')) {
    return body(
      res,
      200,
      {'Content-Type': 'text/html', 'Cache-Control': 'no-store'},
      '<!doctype html><meta charset="utf-8"><title>ngsw probe</title><body>ready</body>',
    );
  }
  if (req.url === '/ngsw-worker.js') {
    return body(
      res,
      200,
      {'Content-Type': 'application/javascript', 'Cache-Control': 'no-store'},
      fs.readFileSync(workerPath),
    );
  }
  if (req.url.startsWith('/ngsw.json')) {
    return body(
      res,
      200,
      {'Content-Type': 'application/json', 'Cache-Control': 'no-store'},
      JSON.stringify(manifest),
    );
  }
  if (req.url.startsWith('/runtime-config.json')) {
    return body(
      res,
      200,
      {'Content-Type': 'application/json', 'Cache-Control': 'max-age=3600'},
      req.url.includes('attacker') ? 'attacker-config' : 'clean-config',
    );
  }
  return body(res, 404, {'Content-Type': 'text/plain'}, 'missing');
});

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cdp(method, params = {}) {
  globalThis.__cdpId = (globalThis.__cdpId || 0) + 1;
  const id = globalThis.__cdpId;
  globalThis.__cdpSocket.send(JSON.stringify({id, method, params}));
  return await new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id !== id) return;
      globalThis.__cdpSocket.removeEventListener('message', onMessage);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    };
    globalThis.__cdpSocket.addEventListener('message', onMessage);
  });
}

async function main() {
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ngsw-ignoresearch-'));
  const chrome = (chromeProcess = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ]));

  let stderr = '';
  const wsUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Chrome did not expose CDP: ${stderr}`)), 15000);
    chrome.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    chrome.on('exit', (code) => reject(new Error(`Chrome exited early: ${code}\n${stderr}`)));
  });

  const cdpPort = new URL(wsUrl).port;
  const targets = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then((r) =>
    r.json(),
  );
  const pageTarget = targets.find((target) => target.type === 'page');
  if (!pageTarget) throw new Error(`No page target found: ${JSON.stringify(targets)}`);
  globalThis.__cdpSocket = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolve) => globalThis.__cdpSocket.addEventListener('open', resolve, {once: true}));

  await cdp('Runtime.enable');
  await cdp('Page.enable');

  const evalExpr = async (expression) => {
    const result = await cdp('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };

  await cdp('Page.navigate', {url: `http://127.0.0.1:${PORT}/index.html`});
  for (let i = 0; i < 50; i++) {
    if (await evalExpr('document.readyState === "complete"')) break;
    await wait(100);
  }

  await evalExpr(`
    navigator.serviceWorker.register('/ngsw-worker.js')
      .then(() => navigator.serviceWorker.ready)
      .then(() => true)
  `);

  await cdp('Page.navigate', {url: `http://127.0.0.1:${PORT}/index.html?controlled=1`});
  for (let i = 0; i < 50; i++) {
    if (await evalExpr('document.readyState === "complete"')) break;
    await wait(100);
  }
  let controlled = false;
  for (let i = 0; i < 50; i++) {
    controlled = await evalExpr('Boolean(navigator.serviceWorker.controller)');
    if (controlled) break;
    await wait(100);
  }
  if (!controlled) throw new Error('Page is not controlled by the Angular service worker.');

  const first = await evalExpr(`fetch('/runtime-config.json?attacker').then((r) => r.text())`);
  const hitCountAfterFirst = hits.filter((url) => url.startsWith('/runtime-config.json')).length;
  const cachesAfterFirst = await evalExpr(`
    caches.keys().then(async (names) => {
      const out = {};
      for (const name of names) {
        const cache = await caches.open(name);
        out[name] = (await cache.keys()).map((req) => req.url);
      }
      return out;
    })
  `);
  const ngswState = await evalExpr(`fetch('/ngsw/state').then((r) => r.text())`);
  const second = await evalExpr(`fetch('/runtime-config.json').then((r) => r.text())`);
  const runtimeHits = hits.filter((url) => url.startsWith('/runtime-config.json'));

  console.log(
    JSON.stringify(
      {
        first,
        second,
        hitCountAfterFirst,
        cachesAfterFirst,
        ngswState,
        runtimeHits,
        controlled,
        allHits: hits,
      },
      null,
      2,
    ),
  );

  globalThis.__cdpSocket.close();
  chrome.kill('SIGTERM');
  server.close();
}

main().catch((err) => {
  console.error(err.stack || err);
  if (globalThis.__cdpSocket) globalThis.__cdpSocket.close();
  if (chromeProcess) chromeProcess.kill('SIGTERM');
  server.close();
  process.exitCode = 1;
});
