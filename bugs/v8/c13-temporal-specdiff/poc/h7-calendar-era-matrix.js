// C13 H7: PrepareCalendarFields era support matrix. It hardcodes
// "all except iso/chinese/dangi support eras"; probe less-common calendars.

function probe(name, obj) {
  try {
    const value = Temporal.PlainDate.from(obj);
    print(name + ': OK ' + String(value));
  } catch (e) {
    print(name + ': THROW ' + e.name + ' ' + e.message);
  }
}

const cases = [
  ['buddhist era no year', { calendar: 'buddhist', era: 'be', eraYear: 2563, month: 5, day: 1 }],
  ['roc era no year', { calendar: 'roc', era: 'minguo', eraYear: 109, month: 5, day: 1 }],
  ['japanese era no year', { calendar: 'japanese', era: 'reiwa', eraYear: 2, month: 5, day: 1 }],
  ['gregory bce', { calendar: 'gregory', era: 'bce', eraYear: 1, month: 1, day: 1 }],
  ['chinese era fields', { calendar: 'chinese', era: 'foo', eraYear: 1, monthCode: 'M01', day: 1 }],
  ['dangi era fields', { calendar: 'dangi', era: 'foo', eraYear: 1, monthCode: 'M01', day: 1 }],
  ['hebrew era fields', { calendar: 'hebrew', era: 'am', eraYear: 5780, monthCode: 'M01', day: 1 }],
  ['islamic era fields', { calendar: 'islamic', era: 'ah', eraYear: 1442, monthCode: 'M01', day: 1 }],
];

for (const [name, obj] of cases) probe(name, obj);
print('H7 DONE');

