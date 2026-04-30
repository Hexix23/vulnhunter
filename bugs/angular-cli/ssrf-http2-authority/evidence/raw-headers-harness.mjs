import http2 from 'node:http2';
import { once } from 'node:events';

const server = http2.createServer((req, res) => {
  console.log('RAW HEADERS:', JSON.stringify(req.headers, null, 2));
  res.end('ok');
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const { port } = server.address();

const client = http2.connect(`http://127.0.0.1:${port}`);
const req = client.request({ ':method': 'GET', ':path': '/', ':authority': 'custom.authority.example:9999' });
req.setEncoding('utf8');
req.end();
await once(req, 'end');
client.close();
server.close();
