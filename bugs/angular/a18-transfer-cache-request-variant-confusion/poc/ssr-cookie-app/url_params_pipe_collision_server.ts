import 'zone.js/node';
import '@angular/compiler';
import express from 'express';
import {BootstrapContext, Component, inject} from '@angular/core';
import {HttpClient, HttpParams, provideHttpClient, withFetch} from '@angular/common/http';
import {bootstrapApplication} from '@angular/platform-browser';
import {provideClientHydration} from '@angular/platform-browser';
import {provideServerRendering, renderApplication} from '@angular/platform-server';

@Component({
  selector: 'app-root',
  standalone: true,
  template: `<main><div id="pipe">{{ pipe }}</div></main>`,
})
class UrlParamsPipeCollisionComponent {
  pipe = 'pending';

  constructor() {
    const http = inject(HttpClient);
    const pipeParam = new HttpParams({fromObject: {x: 'y||'}});

    http.get('/api/u', {params: pipeParam, responseType: 'text'}).subscribe({
      next: (firstBody) => {
        this.pipe = 'first=' + firstBody;
        console.log('[ssr] first pipe body:', firstBody);
        http.get('/api/u||x=y', {responseType: 'text'}).subscribe({
          next: (secondBody) => {
            this.pipe += '|second=' + secondBody;
            console.log('[ssr] second pipe body:', secondBody);
          },
          error: (error) => {
            this.pipe += '|second-error:' + (error?.message ?? error);
          },
        });
      },
      error: (error) => {
        this.pipe = 'first-error:' + (error?.message ?? error);
      },
    });
  }
}

function bootstrap(context: BootstrapContext) {
  return bootstrapApplication(
    UrlParamsPipeCollisionComponent,
    {
      providers: [provideServerRendering(), provideClientHydration(), provideHttpClient(withFetch())],
    },
    context,
  );
}

const indexHtml = '<!doctype html><html><head></head><body><app-root></app-root></body></html>';
const app = express();
let apiHits = 0;

app.get(/^\/api\/u/, (req, res) => {
  apiHits++;
  const body = req.originalUrl.includes('?') ? `query-path:${req.originalUrl}` : `literal-path:${req.originalUrl}`;
  console.log('[api] /api/u* hit', apiHits, 'url=', req.originalUrl, 'body=', body);
  res.setHeader('Cache-Control', 'private, no-store');
  res.type('text/plain').send(body);
});

app.get('/', async (req, res) => {
  const url = `${req.protocol}://${req.headers.host}${req.originalUrl}`;
  apiHits = 0;
  console.log('[express] render url:', url);

  try {
    const html = await renderApplication((context) => bootstrap(context), {
      document: indexHtml,
      url,
    });
    console.log('[express] api hit counts pipe=', apiHits);
    res.type('html').send(html);
  } catch (error) {
    console.error('[express] render error:', error);
    res.status(500).send(String(error));
  }
});

app.listen(4224, '127.0.0.1', () => {
  console.log('A18 URL/params pipe probe listening on http://127.0.0.1:4224/');
});
