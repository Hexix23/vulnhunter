import http from 'node:http';

const host = '127.0.0.1';
const port = Number(process.env.VICTIM_PORT ?? '13306');
const body = 'INTERNAL_SECRET_CREDS=aws_key=AKIAXXXXXXXX';

http
  .createServer((req, res) => {
    console.log(`victim served ${req.method} ${req.url}`);
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(body);
  })
  .listen(port, host, () => console.log(`victim on http://${host}:${port}`));
