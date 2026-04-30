function show(name, thunk) {
  try {
    print(name + ': OK ' + String(thunk()));
  } catch (e) {
    print(name + ': THROW ' + e.name + ' ' + e.message);
  }
}

const df = new Intl.DurationFormat('en-US', {style: 'digital'});

show('DF string 1ns', () => df.format('PT0.000000001S'));
show('Temporal.toLocaleString 1ns', () =>
  Temporal.Duration.from('PT0.000000001S').toLocaleString('en-US', {style: 'digital'}));

show('DF object mixed-sign', () => df.format({seconds: 1, milliseconds: -1}));
show('Temporal.from mixed-sign', () =>
  Temporal.Duration.from({seconds: 1, milliseconds: -1}).toLocaleString('en-US', {style: 'digital'}));

show('DF object huge edge', () =>
  df.format({hours: 0, minutes: 0, seconds: 9007199254740991, nanoseconds: 712}));

show('DF string huge edge', () =>
  df.format('PT9007199254740991.000000712S'));
