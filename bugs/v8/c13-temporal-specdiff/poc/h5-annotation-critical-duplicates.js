// C13 H5: Temporal annotation handling beyond duplicate u-ca.
// Looking for accepted critical unknown annotations and non-calendar duplicate
// annotation inconsistencies.

function probe(name, fn) {
  try {
    const value = fn();
    print(name + ': OK ' + String(value));
  } catch (e) {
    print(name + ': THROW ' + e.name + ' ' + e.message);
  }
}

const pd = Temporal.PlainDate;
const pdt = Temporal.PlainDateTime;
const zdt = Temporal.ZonedDateTime;

probe('PlainDate unknown noncritical', () =>
  pd.from('2020-01-01[foo=bar]'));
probe('PlainDate unknown critical', () =>
  pd.from('2020-01-01[!foo=bar]'));
probe('PlainDate duplicate unknown', () =>
  pd.from('2020-01-01[foo=one][foo=two]'));
probe('PlainDate duplicate critical unknown', () =>
  pd.from('2020-01-01[!foo=one][foo=two]'));

probe('PlainDateTime unknown critical', () =>
  pdt.from('2020-01-01T12:34:56[!foo=bar]'));
probe('ZonedDateTime unknown critical', () =>
  zdt.from('2020-01-01T00:00Z[UTC][!foo=bar]'));
probe('ZonedDateTime duplicate noncritical tz anno', () =>
  zdt.from('2020-01-01T00:00Z[UTC][u-tz=utc][u-tz=usnyc]'));
probe('ZonedDateTime critical tz anno', () =>
  zdt.from('2020-01-01T00:00Z[UTC][!u-tz=utc]'));

print('H5 DONE');

