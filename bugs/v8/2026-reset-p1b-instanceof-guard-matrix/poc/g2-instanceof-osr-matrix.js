// Flags: --allow-natives-syntax --maglev --turbofan

function fail(msg) { throw new Error(msg); }

function assertEquals(expected, actual, label) {
  if (expected !== actual) fail(`${label}: expected ${expected}, got ${actual}`);
}

const own = {};
Object.defineProperty(own, Symbol.hasInstance, {
  value() { return true; },
  configurable: true,
});

const protoBase = {};
Object.defineProperty(protoBase, Symbol.hasInstance, {
  value() { return true; },
  configurable: true,
});
const proto = Object.create(protoBase);

const nonCallable = {};
Object.defineProperty(nonCallable, Symbol.hasInstance, {
  value: {},
  configurable: true,
});

function sideEffect(v) {
  try {
    v.toString();
  } catch (e) {}
  return v;
}

function osrCase(which, trigger) {
  let result = false;
  for (let i = 0; i < 40; i++) {
    let callable = which === 0 ? own : which === 1 ? proto : nonCallable;
    callable = sideEffect(callable);
    if (i === 3 && trigger) %OptimizeOsr();
    try {
      result = ({} instanceof callable);
      if (which === 2) fail("expected TypeError");
    } catch (e) {
      if (which !== 2 || !(e instanceof TypeError)) throw e;
      result = "throws";
    }
  }
  return result;
}

%PrepareFunctionForOptimization(osrCase);
assertEquals(true, osrCase(0, false), "own/warm");
assertEquals(true, osrCase(1, false), "proto/warm");
assertEquals("throws", osrCase(2, false), "noncallable/warm");

assertEquals(true, osrCase(0, true), "own/osr");
assertEquals(true, osrCase(1, true), "proto/osr");
assertEquals("throws", osrCase(2, true), "noncallable/osr");
