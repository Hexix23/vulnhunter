import { createServer } from 'node:http';
const secret = process.env.INTERNAL_SECRET ?? 'internal-default';
const port = Number(process.env.PORT ?? 13306);
createServer((req, res) => {
  res.setHeader('content-type', 'text/plain');
  res.end(`SECRET-INTERNAL-${secret}`);
}).listen(port, '127.0.0.1', () => {
  console.log(`mock internal on 127.0.0.1:${port} (secret=${secret})`);
});
