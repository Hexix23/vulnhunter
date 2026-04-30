function probe(name, fn) {
  try {
    const value = fn();
    print(name + ': OK ' + String(value));
  } catch (e) {
    print(name + ': THROW ' + e.name + ' ' + e.message);
  }
}

probe('PlainDate dup-ca', () =>
  Temporal.PlainDate.from('2020-01-01[u-ca=gregory][u-ca=iso8601]'));

probe('PlainDateTime dup-ca', () =>
  Temporal.PlainDateTime.from('2020-01-01T12:34:56[u-ca=gregory][u-ca=iso8601]'));

probe('PlainMonthDay dup-ca', () =>
  Temporal.PlainMonthDay.from('--01-01[u-ca=gregory][u-ca=iso8601]'));

probe('PlainYearMonth dup-ca', () =>
  Temporal.PlainYearMonth.from('2020-01[u-ca=gregory][u-ca=iso8601]'));

probe('ZonedDateTime dup-ca', () =>
  Temporal.ZonedDateTime.from('2020-01-01T00:00Z[UTC][u-ca=gregory][u-ca=iso8601]'));
