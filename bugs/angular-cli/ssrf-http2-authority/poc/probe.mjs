import http2 from 'node:http2';
import { once } from 'node:events';

const port = Number(process.env.TARGET_PORT ?? 4000);
const authority = process.argv[2];
const path = process.argv[3] ?? '/';
if (!authority) {
  console.error('usage: probe.mjs <authority> [path]');
  process.exit(2);
}

const client = http2.connect(`http://127.0.0.1:${port}`);
const req = client.request({
  ':method': 'GET',
  ':path': path,
  ':authority': authority,
});

let headers = null;
let body = '';
req.on('response', (h) => { headers = h; });
req.setEncoding('utf8');
req.on('data', (chunk) => { body += chunk; });
req.end();
await once(req, 'end');
client.close();

console.log('STATUS', headers[':status']);
console.log('---BODY---');
console.log(body);
