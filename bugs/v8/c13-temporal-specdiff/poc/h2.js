function probe(name, fn) {
  try {
    const value = fn();
    print(name + ': OK ' + String(value));
  } catch (e) {
    print(name + ': THROW ' + e.name + ' ' + e.message);
  }
}

probe('PlainDate critical-first', () =>
  Temporal.PlainDate.from('2020-01-01[!u-ca=iso8601][u-ca=gregory]'));

probe('PlainDate critical-second', () =>
  Temporal.PlainDate.from('2020-01-01[u-ca=gregory][!u-ca=iso8601]'));

probe('PlainDateTime critical-mixed', () =>
  Temporal.PlainDateTime.from('2020-01-01T12:34:56[!u-ca=gregory][u-ca=iso8601]'));

probe('ZonedDateTime critical-mixed', () =>
  Temporal.ZonedDateTime.from('2020-01-01T00:00Z[UTC][!u-ca=gregory][u-ca=iso8601]'));
