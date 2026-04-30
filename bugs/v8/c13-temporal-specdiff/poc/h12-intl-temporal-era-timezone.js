// C13/C15 H12: Intl.DateTimeFormat x Temporal known sink expansion.
// test262 status marks era/ignore-timezone failures; this captures output and
// checks adjacent APIs not all listed in status.

function show(name, fn) {
  try {
    const value = fn();
    print(name + ': OK ' + String(value));
  } catch (e) {
    print(name + ': THROW ' + e.name + ' ' + e.message);
  }
}

function parts(name, fn) {
  try {
    const value = fn();
    print(name + ': OK ' + value.map(p => p.type + '=' + p.value).join('|'));
  } catch (e) {
    print(name + ': THROW ' + e.name + ' ' + e.message);
  }
}

const eraFmt = new Intl.DateTimeFormat('en', { era: 'narrow' });
const eraRangeFmt = new Intl.DateTimeFormat('en', { era: 'narrow', timeZone: 'UTC' });

show('Date era baseline', () => new Date(0).toLocaleString('en', { era: 'narrow' }));
show('Instant toLocaleString era', () =>
  new Temporal.Instant(0n).toLocaleString('en', { era: 'narrow' }));
show('PlainDate toLocaleString era', () =>
  new Temporal.PlainDate(2000, 5, 2, 'gregory').toLocaleString('en', { era: 'narrow' }));
show('PlainTime toLocaleString era', () =>
  new Temporal.PlainTime(14, 46).toLocaleString('en', { era: 'narrow' }));

show('DTF format PlainDate era', () =>
  eraFmt.format(new Temporal.PlainDate(2025, 11, 4)));
show('DTF format PlainTime era', () =>
  eraFmt.format(new Temporal.PlainTime(14, 46)));
show('DTF format Instant era', () =>
  eraFmt.format(new Temporal.Instant(0n)));

parts('DTF formatToParts PlainDate era', () =>
  eraFmt.formatToParts(new Temporal.PlainDate(2025, 11, 4)));
parts('DTF formatToParts PlainTime era', () =>
  eraFmt.formatToParts(new Temporal.PlainTime(14, 46)));
parts('DTF formatToParts Instant era', () =>
  eraFmt.formatToParts(new Temporal.Instant(0n)));

show('DTF formatRange PlainDate era', () =>
  eraRangeFmt.formatRange(new Temporal.PlainDate(2025, 11, 4),
                          new Temporal.PlainDate(2025, 11, 5)));
parts('DTF formatRangeToParts PlainDate era', () =>
  eraRangeFmt.formatRangeToParts(new Temporal.PlainDate(2025, 11, 4),
                                 new Temporal.PlainDate(2025, 11, 5)));

const pdtApia = Temporal.PlainDateTime.from('2011-12-30T12:00:00');
const pdtLA = Temporal.PlainDateTime.from('2026-03-08T02:00:00');
const ptLA = Temporal.PlainTime.from('2026-03-08T02:00:00');

const dtfApia = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Pacific/Apia',
});
const dtfLA = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Los_Angeles',
});

show('ignore timezone PlainDateTime Apia', () => dtfApia.format(pdtApia));
show('ignore timezone PlainDateTime LA gap', () => dtfLA.format(pdtLA));
show('ignore timezone PlainTime LA gap', () => dtfLA.format(ptLA));
parts('ignore timezone formatToParts PlainDateTime LA gap', () =>
  dtfLA.formatToParts(pdtLA));

// State pollution check: formatting a plain object must not corrupt later
// Instant formatting with same DateTimeFormat.
show('state before Instant', () => dtfLA.format(new Temporal.Instant(0n)));
show('state PlainDateTime', () => dtfLA.format(pdtLA));
show('state after Instant', () => dtfLA.format(new Temporal.Instant(0n)));

print('H12 DONE');

