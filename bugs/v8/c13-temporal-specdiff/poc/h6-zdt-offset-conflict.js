// C13 H6: ZonedDateTime string/object offset and time-zone conflict behavior.

function show(name, fn) {
  try {
    const value = fn();
    print(name + ': OK ' + String(value) + ' epoch=' + value.epochNanoseconds);
  } catch (e) {
    print(name + ': THROW ' + e.name + ' ' + e.message);
  }
}

const s = '2020-01-01T00:00-04:00[UTC]';
for (const offset of ['reject', 'prefer', 'use', 'ignore']) {
  show('string conflict offset=' + offset, () =>
    Temporal.ZonedDateTime.from(s, { offset }));
}

const obj = {
  year: 2020,
  month: 1,
  day: 1,
  hour: 0,
  minute: 0,
  second: 0,
  offset: '-04:00',
  timeZone: 'UTC',
};
for (const offset of ['reject', 'prefer', 'use', 'ignore']) {
  show('object conflict offset=' + offset, () =>
    Temporal.ZonedDateTime.from(obj, { offset }));
}

// DST gap/fold with disambiguation to catch ignored option paths.
const gap = '2021-03-14T02:30-05:00[America/New_York]';
for (const disambiguation of ['compatible', 'earlier', 'later', 'reject']) {
  show('gap disambiguation=' + disambiguation, () =>
    Temporal.ZonedDateTime.from(gap, { disambiguation, offset: 'ignore' }));
}

print('H6 DONE');

