// C13 H8: PrepareCalendarFields field get order and side effects.
// Spec sorts field names lexicographically. This catches V8/Rust path order
// divergence and mutation-after-read confusion.

function logProbe(name, fn) {
  const log = [];
  try {
    const value = fn(log);
    print(name + ': OK ' + String(value) + ' log=' + log.join(','));
  } catch (e) {
    print(name + ': THROW ' + e.name + ' ' + e.message + ' log=' + log.join(','));
  }
}

logProbe('PlainDate getter order mutate month', (log) => {
  const obj = {
    calendar: 'iso8601',
    get day() { log.push('day'); return 1; },
    get month() { log.push('month'); return 1; },
    get monthCode() { log.push('monthCode'); this.month = 12; return undefined; },
    get year() { log.push('year'); return 2020; },
  };
  return Temporal.PlainDate.from(obj);
});

logProbe('ZDT getter order offset/timeZone', (log) => {
  const obj = {
    calendar: 'iso8601',
    get day() { log.push('day'); return 1; },
    get hour() { log.push('hour'); return 0; },
    get microsecond() { log.push('microsecond'); return 0; },
    get millisecond() { log.push('millisecond'); return 0; },
    get minute() { log.push('minute'); return 0; },
    get month() { log.push('month'); return 1; },
    get monthCode() { log.push('monthCode'); return undefined; },
    get nanosecond() { log.push('nanosecond'); return 0; },
    get offset() { log.push('offset'); return '+00:00'; },
    get second() { log.push('second'); return 0; },
    get timeZone() { log.push('timeZone'); return 'UTC'; },
    get year() { log.push('year'); return 2020; },
  };
  return Temporal.ZonedDateTime.from(obj);
});

print('H8 DONE');

