import http from 'node:http';
const stamp = Date.now();
http.createServer((req, res) => {
  console.log(`[victim:8765] ${req.method} ${req.url}`);
  res.end(`COMMA_LEAK_SECRET_${stamp}`);
}).listen(8765, '127.0.0.1', () => console.log(`victim listening 8765 stamp=${stamp}`));
