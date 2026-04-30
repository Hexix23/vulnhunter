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
  template: `<main><div id="scope">{{ scope }}</div></main>`,
})
class ParamsCollisionComponent {
  scope = 'pending';

  constructor() {
    const http = inject(HttpClient);
    const multiValue = new HttpParams({fromObject: {role: ['user', 'admin']}});
    const commaValue = new HttpParams({fromObject: {role: 'user,admin'}});

    http.get('/api/scope', {params: multiValue, responseType: 'text'}).subscribe({
      next: (firstBody) => {
        this.scope = 'first=' + firstBody;
        console.log('[ssr] first scope body:', firstBody);
        http.get('/api/scope', {params: commaValue, responseType: 'text'}).subscribe({
          next: (secondBody) => {
            this.scope += '|second=' + secondBody;
            console.log('[ssr] second scope body:', secondBody);
          },
          error: (error) => {
            this.scope += '|second-error:' + (error?.message ?? error);
          },
        });
      },
      error: (error) => {
        this.scope = 'first-error:' + (error?.message ?? error);
      },
    });
  }
}

function bootstrap(context: BootstrapContext) {
  return bootstrapApplication(
    ParamsCollisionComponent,
    {
      providers: [provideServerRendering(), provideClientHydration(), provideHttpClient(withFetch())],
    },
    context,
  );
}

const indexHtml = '<!doctype html><html><head></head><body><app-root></app-root></body></html>';
const app = express();
let scopeHits = 0;

app.get('/api/scope', (req, res) => {
  scopeHits++;
  const requestUrl = new URL(req.originalUrl, 'http://127.0.0.1:4222');
  const roles = requestUrl.searchParams.getAll('role');
  const body = roles.length > 1 ? `multi:${roles.join('|')}` : `scalar:${roles[0] ?? ''}`;
  console.log('[api] /api/scope hit', scopeHits, 'url=', req.originalUrl, 'body=', body);
  res.setHeader('Vary', 'role');
  res.setHeader('Cache-Control', 'private, no-store');
  res.type('text/plain').send(body);
});

app.get('/', async (req, res) => {
  const url = `${req.protocol}://${req.headers.host}${req.originalUrl}`;
  scopeHits = 0;
  console.log('[express] render url:', url);

  try {
    const html = await renderApplication((context) => bootstrap(context), {
      document: indexHtml,
      url,
    });
    console.log('[express] api hit counts scope=', scopeHits);
    res.type('html').send(html);
  } catch (error) {
    console.error('[express] render error:', error);
    res.status(500).send(String(error));
  }
});

app.listen(4222, '127.0.0.1', () => {
  console.log('A18 deterministic params probe listening on http://127.0.0.1:4222/');
});
