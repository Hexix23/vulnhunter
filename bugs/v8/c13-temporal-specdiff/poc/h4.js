function probe(name, fn) {
  try {
    print(name + ': OK ' + String(fn()));
  } catch (e) {
    print(name + ': THROW ' + e.name + ' ' + e.message);
  }
}

probe('japanese consistent', () =>
  Temporal.PlainDate.from({
    calendar: 'japanese',
    era: 'reiwa',
    eraYear: 2,
    month: 5,
    day: 1,
  }));

probe('japanese contradictory year', () =>
  Temporal.PlainDate.from({
    calendar: 'japanese',
    era: 'reiwa',
    eraYear: 2,
    year: 1999,
    month: 5,
    day: 1,
  }));

probe('gregory contradictory year', () =>
  Temporal.PlainDate.from({
    calendar: 'gregory',
    era: 'ce',
    eraYear: 2020,
    year: 2021,
    month: 5,
    day: 1,
  }));

probe('iso era no year', () =>
  Temporal.PlainDate.from({
    calendar: 'iso8601',
    era: 'ce',
    eraYear: 2020,
    month: 5,
    day: 1,
  }));

probe('gregory era no year', () =>
  Temporal.PlainDate.from({
    calendar: 'gregory',
    era: 'ce',
    eraYear: 2020,
    month: 5,
    day: 1,
  }));
