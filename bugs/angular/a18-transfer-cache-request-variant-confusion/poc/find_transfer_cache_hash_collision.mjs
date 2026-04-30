function generateHash(value) {
  let hash = 0;
  for (const char of value) {
    hash = (Math.imul(31, hash) + char.charCodeAt(0)) << 0;
  }
  hash += 2147483647 + 1;
  return hash.toString();
}

const seen = new Map();
const chars = 'abcdefghijklmnopqrstuvwxyz0123456789-_';
const prefix = process.argv[2] ?? 'GET|text|/collision/';
const suffix = process.argv[3] ?? '||';
const length = Number(process.argv[4] ?? 10);

function randomToken(size) {
  let token = '';
  for (let i = 0; i < size; i++) {
    token += chars[(Math.random() * chars.length) | 0];
  }
  return token;
}

for (let i = 0; i < 1_500_000; i++) {
  const token = randomToken(length);
  const key = prefix + token + suffix;
  const hash = generateHash(key);
  const previous = seen.get(hash);
  if (previous && previous !== token) {
    console.log(JSON.stringify({attempts: i, hash, a: prefix + previous + suffix, b: key}, null, 2));
    process.exit(0);
  }
  seen.set(hash, token);
}

console.error('No collision found');
process.exit(1);
