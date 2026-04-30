import 'zone.js/node';
import '@angular/compiler';
import express from 'express';
import {BootstrapContext, Component, InjectionToken, inject} from '@angular/core';
import {
  HttpClient,
  HttpInterceptorFn,
  provideHttpClient,
  withFetch,
  withInterceptors,
} from '@angular/common/http';
import {bootstrapApplication} from '@angular/platform-browser';
import {provideClientHydration} from '@angular/platform-browser';
import {provideServerRendering, renderApplication} from '@angular/platform-server';

const INBOUND_COOKIE = new InjectionToken<string>('INBOUND_COOKIE');

const cookieForwarder: HttpInterceptorFn = (req, next) => {
  const cookie = inject(INBOUND_COOKIE, {optional: true});
  if (cookie) {
    req = req.clone({headers: req.headers.set('Cookie', cookie)});
  }
  return next(req);
};

@Component({
  selector: 'app-root',
  standalone: true,
  template: `<main><div id="private">{{ privateData }}</div></main>`,
})
class PrivateComponent {
  privateData = 'pending';

  constructor() {
    inject(HttpClient).get('/api/private', {responseType: 'text'}).subscribe({
      next: (body) => {
        this.privateData = body;
        console.log('[origin:ssr] private body:', body);
      },
      error: (error) => {
        this.privateData = 'error:' + (error?.message ?? error);
      },
    });
  }
}

function bootstrap(context: BootstrapContext, cookie: string) {
  return bootstrapApplication(
    PrivateComponent,
    {
      providers: [
        provideServerRendering(),
        provideClientHydration(),
        provideHttpClient(withFetch(), withInterceptors([cookieForwarder])),
        {provide: INBOUND_COOKIE, useValue: cookie},
      ],
    },
    context,
  );
}

const origin = express();
const proxy = express();
const htmlCache = new Map<string, string>();
const indexHtml = '<!doctype html><html><head></head><body><app-root></app-root></body></html>';

let privateHits = 0;

origin.get('/api/private', (req, res) => {
  privateHits++;
  const cookie = req.headers.cookie || 'none';
  console.log('[origin:api] /api/private hit', privateHits, 'cookie=', JSON.stringify(cookie));
  res.setHeader('Vary', 'Cookie');
  res.setHeader('Cache-Control', 'private, no-store');
  res.type('text/plain').send(`private:${cookie}`);
});

origin.get('/private', async (req, res) => {
  const url = `${req.protocol}://${req.headers.host}${req.originalUrl}`;
  const cookie = req.headers.cookie || '';
  console.log('[origin] render url:', url, 'cookie=', JSON.stringify(cookie));

  const html = await renderApplication((context) => bootstrap(context, cookie), {
    document: indexHtml,
    url,
  });

  // Models a common deployment mistake: HTML is cacheable even though SSR embedded a private
  // no-store API response into ng-state.
  res.setHeader('Cache-Control', 'public, s-maxage=600');
  res.type('html').send(html);
});

proxy.get('/private', async (req, res) => {
  const key = req.originalUrl;
  const cached = htmlCache.get(key);
  if (cached) {
    console.log('[proxy] HIT', key, 'cookie=', JSON.stringify(req.headers.cookie || ''));
    res.setHeader('X-Proxy-Cache', 'HIT');
    res.type('html').send(cached);
    return;
  }

  console.log('[proxy] MISS', key, 'cookie=', JSON.stringify(req.headers.cookie || ''));
  const originResponse = await fetch(`http://127.0.0.1:4220${req.originalUrl}`, {
    headers: {Cookie: req.headers.cookie || ''},
  });
  const html = await originResponse.text();
  htmlCache.set(key, html);
  res.setHeader('X-Proxy-Cache', 'MISS');
  res.type('html').send(html);
});

origin.listen(4220, '127.0.0.1', () => {
  console.log('A18 private-state origin listening on http://127.0.0.1:4220/private');
});

proxy.listen(4221, '127.0.0.1', () => {
  console.log('A18 shared-cache proxy listening on http://127.0.0.1:4221/private');
});
