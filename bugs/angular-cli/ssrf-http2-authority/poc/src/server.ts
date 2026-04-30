import {
  AngularNodeAppEngine,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import { createServer as createHttp2Server } from 'node:http2';

const angularApp = new AngularNodeAppEngine();

const server = createHttp2Server();

const selfSecret = process.env['SELF_SECRET'] ?? 'public-default';

server.on('request', (req, res) => {
  if (req.url === '/probe' || req.url?.startsWith('/probe?')) {
    res.setHeader('content-type', 'text/plain');
    res.end(`public-probe-${selfSecret}`);
    return;
  }

  angularApp
    .handle(req)
    .then((response) => {
      if (response) {
        writeResponseToNodeResponse(response, res);
        return;
      }
      res.statusCode = 404;
      res.end('not found');
    })
    .catch((err) => {
      res.statusCode = 500;
      res.end(`internal error: ${err?.message ?? err}`);
    });
});

const port = Number(process.env['PORT'] ?? 4000);
server.listen(port, () => {
  console.log(`Angular SSR HTTP/2 (h2c) listening on http://127.0.0.1:${port}`);
});
