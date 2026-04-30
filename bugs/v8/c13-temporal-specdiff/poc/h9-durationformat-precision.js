// C13 H9: DurationFormat path casts int64 Temporal duration fields to double.
// Probe values above Number.MAX_SAFE_INTEGER from string input.

function show(name, fn) {
  try {
    const value = fn();
    print(name + ': OK ' + String(value));
  } catch (e) {
    print(name + ': THROW ' + e.name + ' ' + e.message);
  }
}

const values = [
  '9007199254740991',
  '9007199254740992',
  '9007199254740993',
  '9223372036854775807',
];

const dfLong = new Intl.DurationFormat('en-US', { style: 'long' });
const dfDigital = new Intl.DurationFormat('en-US', { style: 'digital' });

for (const v of values) {
  const s = 'PT' + v + 'S';
  show('Duration.from ' + v, () => Temporal.Duration.from(s).toString());
  show('DF long string ' + v, () => dfLong.format(s));
  show('DF digital string ' + v, () => dfDigital.format(s));
  show('toLocaleString long ' + v, () =>
    Temporal.Duration.from(s).toLocaleString('en-US', { style: 'long' }));
}

print('H9 DONE');

