import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

// Local decoy route. When SSR resolves `/api/internal` against its own origin
// (no X-Forwarded-Host pivot), this responds so we can distinguish from a pivot.
app.get('/api/internal', (_req, res) => {
  res.type('text/plain').send('LOCAL_EXPRESS_ROUTE_SHOULD_NOT_BE_USED');
});

app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

const port = process.env['PORT'] || 4200;
app.listen(port, (error) => {
  if (error) {
    throw error;
  }
  console.log(`server listening on http://localhost:${port}`);
});

export const reqHandler = createNodeRequestHandler(app);
