// C13 H11: Exact local test262 shape:
// "More than one calendar annotation is not syntactical if any have the
// critical flag" for PlainTime and Instant entrypoints.

function mustThrow(name, fn) {
  try {
    const value = fn();
    print(name + ': FAIL OK ' + String(value));
  } catch (e) {
    print(name + ': THROW ' + e.name + ' ' + e.message);
  }
}

const plainTimeInvalid = [
  '00:00[u-ca=iso8601][!u-ca=iso8601]',
  '00:00[!u-ca=iso8601][u-ca=iso8601]',
  '00:00[UTC][u-ca=iso8601][!u-ca=iso8601]',
  '00:00[u-ca=iso8601][foo=bar][!u-ca=iso8601]',
  '1970-01-01T00:00[u-ca=iso8601][!u-ca=iso8601]',
  '1970-01-01T00:00[!u-ca=iso8601][u-ca=iso8601]',
  '1970-01-01T00:00[UTC][u-ca=iso8601][!u-ca=iso8601]',
  '1970-01-01T00:00[u-ca=iso8601][foo=bar][!u-ca=iso8601]',
];

const instantInvalid = [
  '1970-01-01T00:00Z[u-ca=iso8601][!u-ca=iso8601]',
  '1970-01-01T00:00Z[!u-ca=iso8601][u-ca=iso8601]',
  '1970-01-01T00:00Z[UTC][u-ca=iso8601][!u-ca=iso8601]',
  '1970-01-01T00:00Z[u-ca=iso8601][foo=bar][!u-ca=iso8601]',
];

for (const s of plainTimeInvalid) {
  mustThrow('PlainTime ' + s, () => Temporal.PlainTime.from(s));
}
for (const s of instantInvalid) {
  mustThrow('Instant ' + s, () => Temporal.Instant.from(s));
}

print('H11 DONE');

