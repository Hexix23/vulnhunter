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
  template: `<main><div id="query">{{ query }}</div></main>`,
})
class ParamsSeparatorCollisionComponent {
  query = 'pending';

  constructor() {
    const http = inject(HttpClient);
    const encodedAmpValue = new HttpParams({fromObject: {a: '1&b=2'}});
    const splitParams = new HttpParams({fromObject: {a: '1', b: '2'}});

    http.get('/api/query', {params: encodedAmpValue, responseType: 'text'}).subscribe({
      next: (firstBody) => {
        this.query = 'first=' + firstBody;
        console.log('[ssr] first query body:', firstBody);
        http.get('/api/query', {params: splitParams, responseType: 'text'}).subscribe({
          next: (secondBody) => {
            this.query += '|second=' + secondBody;
            console.log('[ssr] second query body:', secondBody);
          },
          error: (error) => {
            this.query += '|second-error:' + (error?.message ?? error);
          },
        });
      },
      error: (error) => {
        this.query = 'first-error:' + (error?.message ?? error);
      },
    });
  }
}

function bootstrap(context: BootstrapContext) {
  return bootstrapApplication(
    ParamsSeparatorCollisionComponent,
    {
      providers: [provideServerRendering(), provideClientHydration(), provideHttpClient(withFetch())],
    },
    context,
  );
}

const indexHtml = '<!doctype html><html><head></head><body><app-root></app-root></body></html>';
const app = express();
let queryHits = 0;

app.get('/api/query', (req, res) => {
  queryHits++;
  const requestUrl = new URL(req.originalUrl, 'http://127.0.0.1:4223');
  const aValues = requestUrl.searchParams.getAll('a');
  const bValues = requestUrl.searchParams.getAll('b');
  const body = bValues.length > 0 ? `split:a=${aValues.join(',')}|b=${bValues.join(',')}` : `single:a=${aValues.join(',')}`;
  console.log('[api] /api/query hit', queryHits, 'url=', req.originalUrl, 'body=', body);
  res.setHeader('Cache-Control', 'private, no-store');
  res.type('text/plain').send(body);
});

app.get('/', async (req, res) => {
  const url = `${req.protocol}://${req.headers.host}${req.originalUrl}`;
  queryHits = 0;
  console.log('[express] render url:', url);

  try {
    const html = await renderApplication((context) => bootstrap(context), {
      document: indexHtml,
      url,
    });
    console.log('[express] api hit counts query=', queryHits);
    res.type('html').send(html);
  } catch (error) {
    console.error('[express] render error:', error);
    res.status(500).send(String(error));
  }
});

app.listen(4223, '127.0.0.1', () => {
  console.log('A18 params separator probe listening on http://127.0.0.1:4223/');
});
