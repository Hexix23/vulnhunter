// Flags: --allow-natives-syntax --maglev --turbofan

function fail(msg) { throw new Error(msg); }

function sameValue(a, b) {
  return a === b || (a !== a && b !== b);
}

function assertEquals(expected, actual, label) {
  if (!sameValue(expected, actual)) {
    fail(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertThrows(fn, label) {
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = e instanceof TypeError;
  }
  if (!threw) fail(`${label}: expected TypeError`);
}

function assertOptimizedSomehow(fn, label) {
  const status = %GetOptimizationStatus(fn);
  const optimized = (status & (1 << 3)) !== 0;
  if (!optimized) fail(`${label}: function did not optimize, status=${status}`);
}

function makeProtoHasInstance() {
  const proto = {};
  Object.defineProperty(proto, Symbol.hasInstance, {
    value(x) { return x && x.tag === 0x5151; },
    configurable: true,
  });
  return Object.create(proto);
}

const callableOwnBool = {};
Object.defineProperty(callableOwnBool, Symbol.hasInstance, {
  value(x) { return x && x.tag === 0x5151; },
  configurable: true,
});

const callableOwnNumber = {};
Object.defineProperty(callableOwnNumber, Symbol.hasInstance, {
  value() { return 1; },
  configurable: true,
});

const callableOwnUndefined = {};
Object.defineProperty(callableOwnUndefined, Symbol.hasInstance, {
  value() { return undefined; },
  configurable: true,
});

const callableProto = makeProtoHasInstance();

const callableNonCallableField = {};
Object.defineProperty(callableNonCallableField, Symbol.hasInstance, {
  value: {},
  configurable: true,
});

const callableMutating = {};
Object.defineProperty(callableMutating, Symbol.hasInstance, {
  value(x) {
    Object.defineProperty(callableMutating, Symbol.hasInstance, {
      value() { return false; },
      configurable: true,
    });
    return x && x.tag === 0x5151;
  },
  configurable: true,
});

const good = { tag: 0x5151 };
const bad = { tag: 1 };

const cases = [
  {
    name: "own-bool-true",
    callable: callableOwnBool,
    arg: good,
    expected: true,
  },
  {
    name: "own-bool-false",
    callable: callableOwnBool,
    arg: bad,
    expected: false,
  },
  {
    name: "own-number-toboolean",
    callable: callableOwnNumber,
    arg: bad,
    expected: true,
  },
  {
    name: "own-undefined-toboolean",
    callable: callableOwnUndefined,
    arg: good,
    expected: false,
  },
  {
    name: "proto-bool",
    callable: callableProto,
    arg: good,
    expected: true,
  },
  {
    name: "non-callable-hasinstance",
    callable: callableNonCallableField,
    arg: good,
    throws: true,
  },
];

function check(callable, arg) {
  return arg instanceof callable;
}

for (const tc of cases) {
  %PrepareFunctionForOptimization(check);
  if (tc.throws) {
    assertThrows(() => check(tc.callable, tc.arg), `${tc.name}/warm1`);
    assertThrows(() => check(tc.callable, tc.arg), `${tc.name}/warm2`);
    %OptimizeFunctionOnNextCall(check);
    assertThrows(() => check(tc.callable, tc.arg), `${tc.name}/opt`);
  } else {
    assertEquals(tc.expected, check(tc.callable, tc.arg), `${tc.name}/warm1`);
    assertEquals(tc.expected, check(tc.callable, tc.arg), `${tc.name}/warm2`);
    %OptimizeFunctionOnNextCall(check);
    assertEquals(tc.expected, check(tc.callable, tc.arg), `${tc.name}/opt`);
  }
  assertOptimizedSomehow(check, tc.name);
  %DeoptimizeFunction(check);
}

function checkMutating(arg) {
  return arg instanceof callableMutating;
}

%PrepareFunctionForOptimization(checkMutating);
assertEquals(true, checkMutating(good), "mutating/warm1");
assertEquals(false, checkMutating(good), "mutating/warm2");
%OptimizeFunctionOnNextCall(checkMutating);
assertEquals(false, checkMutating(good), "mutating/opt");
