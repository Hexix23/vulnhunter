function probe(name, fn) {
  try {
    const value = fn();
    print(name + ': OK ' + String(value));
  } catch (e) {
    print(name + ': THROW ' + e.name + ' ' + e.message);
  }
}

probe('PlainDate iso-then-gregory', () =>
  Temporal.PlainDate.from('2020-01-01[u-ca=iso8601][u-ca=gregory]'));

probe('PlainDate same-dup', () =>
  Temporal.PlainDate.from('2020-01-01[u-ca=gregory][u-ca=gregory]'));

probe('PlainDateTime iso-then-gregory', () =>
  Temporal.PlainDateTime.from('2020-01-01T12:34:56[u-ca=iso8601][u-ca=gregory]'));

probe('PlainDateTime same-dup', () =>
  Temporal.PlainDateTime.from('2020-01-01T12:34:56[u-ca=gregory][u-ca=gregory]'));

probe('ZonedDateTime iso-then-gregory', () =>
  Temporal.ZonedDateTime.from('2020-01-01T00:00Z[UTC][u-ca=iso8601][u-ca=gregory]'));

probe('ZonedDateTime same-dup', () =>
  Temporal.ZonedDateTime.from('2020-01-01T00:00Z[UTC][u-ca=gregory][u-ca=gregory]'));
