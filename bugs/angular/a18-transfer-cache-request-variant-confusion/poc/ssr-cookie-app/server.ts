import 'zone.js/node';
import '@angular/compiler';
import express from 'express';
import {
  Component,
  BootstrapContext,
  InjectionToken,
  inject,
} from '@angular/core';
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
const FEED_SUFFIX = new InjectionToken<string>('FEED_SUFFIX');

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
  template: `<main><div id="profile">{{ profile }}</div><div id="authz">{{ authz }}</div><div id="hits">{{ hits }}</div><div id="collision">{{ collision }}</div></main>`,
})
class AppComponent {
  profile = 'pending';
  authz = 'pending';
  hits = 'pending';
  collision = 'pending';

  constructor() {
    const http = inject(HttpClient);
    const feedSuffix = inject(FEED_SUFFIX);

    http.get('/poison?x=yazbadgl', {responseType: 'text'}).subscribe({
      next: (body) => {
        this.profile = 'poison=' + body;
        console.log('[ssr] poison body:', body);
        http.get('/api/profile', {responseType: 'text'}).subscribe({
          next: (profileBody) => {
            this.profile += '|profile=' + profileBody;
            console.log('[ssr] profile body:', profileBody);
          },
          error: (error) => {
            this.profile += '|profile-error:' + (error?.message ?? error);
          },
        });
      },
      error: (error) => {
        this.profile = 'poison-error:' + (error?.message ?? error);
      },
    });

    http.get(`/feed?x=${feedSuffix}`).subscribe({
      next: (feedBody) => {
        this.authz = `feed=${JSON.stringify(feedBody)}`;
        console.log('[ssr] feed body:', JSON.stringify(feedBody));
        http.get('/api/me').subscribe({
          next: (meBody) => {
            const role = typeof meBody === 'object' && meBody !== null ? (meBody as {role?: unknown}).role : undefined;
            const gatedContent = role === 'admin' ? '|ADMIN_PANEL_SECRET' : '|NO_ADMIN';
            this.authz += `|me=${JSON.stringify(meBody)}${gatedContent}`;
            console.log('[ssr] me body:', JSON.stringify(meBody));
          },
          error: (error) => {
            this.authz += '|me-error:' + (error?.message ?? error);
          },
        });
      },
      error: (error) => {
        this.authz = 'feed-error:' + (error?.message ?? error);
      },
    });

    http.get('/api/hits', {headers: {'X-Tenant': 'tenant-a'}, responseType: 'text'}).subscribe({
      next: (body) => {
        this.hits = body;
        console.log('[ssr] first tenant body:', body);
        http.get('/api/hits', {headers: {'X-Tenant': 'tenant-b'}, responseType: 'text'}).subscribe({
          next: (secondBody) => {
            this.hits += '|' + secondBody;
            console.log('[ssr] second tenant body:', secondBody);
          },
          error: (error) => {
            this.hits += '|error:' + (error?.message ?? error);
          },
        });
      },
      error: (error) => {
        this.hits = 'error:' + (error?.message ?? error);
      },
    });

    http.get('/collision/xisvtfhqif', {responseType: 'text'}).subscribe({
      next: (body) => {
        this.collision = body;
        console.log('[ssr] first collision body:', body);
        http.get('/collision/b3g_cxklta', {responseType: 'text'}).subscribe({
          next: (secondBody) => {
            this.collision += '|' + secondBody;
            console.log('[ssr] second collision body:', secondBody);
          },
          error: (error) => {
            this.collision += '|error:' + (error?.message ?? error);
          },
        });
      },
      error: (error) => {
        this.collision = 'error:' + (error?.message ?? error);
      },
    });
  }
}

function bootstrap(context: BootstrapContext, cookie: string, feedSuffix: string) {
  return bootstrapApplication(
    AppComponent,
    {
      providers: [
        provideServerRendering(),
        provideClientHydration(),
        provideHttpClient(withFetch(), withInterceptors([cookieForwarder])),
        {provide: INBOUND_COOKIE, useValue: cookie},
        {provide: FEED_SUFFIX, useValue: feedSuffix},
      ],
    },
    context,
  );
}

const indexHtml = '<!doctype html><html><head></head><body><app-root></app-root></body></html>';
const app = express();

let profileHits = 0;
let meHits = 0;
let feedHits = 0;
let tenantHits = 0;
let collisionHits = 0;

app.get('/api/profile', (req, res) => {
  profileHits++;
  const cookie = req.headers.cookie || 'none';
  console.log('[api] /api/profile hit', profileHits, 'cookie=', JSON.stringify(cookie));
  res.setHeader('Vary', 'Cookie');
  res.setHeader('Cache-Control', 'private, no-store');
  res.type('text/plain').send(`profile:${cookie}`);
});

app.get('/api/me', (req, res) => {
  meHits++;
  const cookie = req.headers.cookie || 'none';
  console.log('[api] /api/me hit', meHits, 'cookie=', JSON.stringify(cookie));
  res.setHeader('Vary', 'Cookie');
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({user: 'alice', role: 'user', cookie});
});

app.get('/poison', (req, res) => {
  console.log('[api] /poison hit query=', JSON.stringify(req.query));
  res.type('text/plain').send('ATTACKER_CONTROLLED_BODY');
});

app.get('/feed', (req, res) => {
  feedHits++;
  console.log('[api] /feed hit', feedHits, 'query=', JSON.stringify(req.query));
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({user: 'attacker', role: 'admin', source: 'feed'});
});

app.get('/api/hits', (req, res) => {
  tenantHits++;
  const tenant = req.headers['x-tenant'] || 'none';
  console.log('[api] /api/hits hit', tenantHits, 'tenant=', JSON.stringify(tenant));
  res.setHeader('Vary', 'X-Tenant');
  res.setHeader('Cache-Control', 'private, no-store');
  res.type('text/plain').send(`tenant:${tenant}`);
});

app.get('/collision/:id', (req, res) => {
  collisionHits++;
  console.log('[api] /collision hit', collisionHits, 'id=', JSON.stringify(req.params.id));
  res.setHeader('Cache-Control', 'private, no-store');
  res.type('text/plain').send(`collision:${req.params.id}`);
});

app.get('/', async (req, res) => {
  const url = `${req.protocol}://${req.headers.host}${req.originalUrl}`;
  const cookie = req.headers.cookie || '';
  const feedSuffix = typeof req.query.feed === 'string' ? req.query.feed : 'safe';
  profileHits = 0;
  meHits = 0;
  feedHits = 0;
  tenantHits = 0;
  collisionHits = 0;
  console.log('[express] render url:', url, 'inbound cookie:', JSON.stringify(cookie));

  try {
    const html = await renderApplication((context) => bootstrap(context, cookie, feedSuffix), {
      document: indexHtml,
      url,
    });
    console.log(
      '[express] api hit counts profile=',
      profileHits,
      'me=',
      meHits,
      'feed=',
      feedHits,
      'tenant=',
      tenantHits,
      'collision=',
      collisionHits,
    );
    res.type('html').send(html);
  } catch (error) {
    console.error('[express] render error:', error);
    res.status(500).send(String(error));
  }
});

app.listen(4218, '127.0.0.1', () => {
  console.log('A18 SSR probe listening on http://127.0.0.1:4218/');
});
