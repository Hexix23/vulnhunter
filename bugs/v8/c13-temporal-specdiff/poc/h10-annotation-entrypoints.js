// C13 H10: duplicate/critical annotations in additional Temporal string
// entrypoints, especially those not carrying calendars.

function probe(name, fn) {
  try {
    const value = fn();
    print(name + ': OK ' + String(value));
  } catch (e) {
    print(name + ': THROW ' + e.name + ' ' + e.message);
  }
}

probe('PlainTime dup calendar', () =>
  Temporal.PlainTime.from('12:34:56[u-ca=gregory][u-ca=iso8601]'));
probe('PlainTime critical calendar', () =>
  Temporal.PlainTime.from('12:34:56[!u-ca=gregory]'));
probe('PlainTime unknown critical', () =>
  Temporal.PlainTime.from('12:34:56[!foo=bar]'));

probe('Instant dup calendar', () =>
  Temporal.Instant.from('2020-01-01T00:00:00Z[u-ca=gregory][u-ca=iso8601]'));
probe('Instant unknown critical', () =>
  Temporal.Instant.from('2020-01-01T00:00:00Z[!foo=bar]'));

probe('Duration dup calendar', () =>
  Temporal.Duration.from('PT1S[u-ca=gregory][u-ca=iso8601]'));
probe('Duration unknown critical', () =>
  Temporal.Duration.from('PT1S[!foo=bar]'));

probe('ZDT duplicate timezone brackets', () =>
  Temporal.ZonedDateTime.from('2020-01-01T00:00Z[UTC][Europe/Paris]'));
probe('ZDT critical timezone bracket', () =>
  Temporal.ZonedDateTime.from('2020-01-01T00:00Z[!UTC]'));
probe('ZDT timezone then calendar then timezone', () =>
  Temporal.ZonedDateTime.from('2020-01-01T00:00Z[UTC][u-ca=gregory][Europe/Paris]'));

print('H10 DONE');

