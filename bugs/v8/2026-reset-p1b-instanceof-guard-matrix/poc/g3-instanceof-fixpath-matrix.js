// Flags: --allow-natives-syntax --maglev --turbofan --turbolev

function fail(msg) { throw new Error(msg); }

function assertEquals(expected, actual, label) {
  if (expected !== actual) {
    fail(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertThrowsTypeError(fn, label) {
  try {
    fn();
  } catch (e) {
    if (e instanceof TypeError) return;
    throw e;
  }
  fail(`${label}: expected TypeError`);
}

function makeOwn(name, value) {
  const rhs = { name, marker: 0x6161 };
  Object.defineProperty(rhs, Symbol.hasInstance, {
    value,
    configurable: true,
  });
  return rhs;
}

function makeProto(name, value) {
  const holder = {};
  Object.defineProperty(holder, Symbol.hasInstance, {
    value,
    configurable: true,
  });
  const rhs = Object.create(holder);
  rhs.name = name;
  rhs.marker = 0x6161;
  return { rhs, holder };
}

function directCase(name, rhs, expected, mutator) {
  function check() {
    return rhs instanceof rhs;
  }

  %PrepareFunctionForOptimization(check);
  assertEquals(expected, check(), `${name}/warm1`);
  assertEquals(expected, check(), `${name}/warm2`);
  %OptimizeFunctionOnNextCall(check);
  if (mutator) mutator();
  assertEquals(mutator ? false : expected, check(), `${name}/opt`);
  %DeoptimizeFunction(check);
}

function directThrowCase(name, rhs) {
  function check() {
    return rhs instanceof rhs;
  }

  %PrepareFunctionForOptimization(check);
  assertThrowsTypeError(check, `${name}/warm1`);
  assertThrowsTypeError(check, `${name}/warm2`);
  %OptimizeFunctionOnNextCall(check);
  assertThrowsTypeError(check, `${name}/opt`);
  %DeoptimizeFunction(check);
}

function osrCase(name, rhs, expected, mutateAt) {
  function sideEffect(v) {
    try {
      v.toString();
    } catch (e) {}
    return v;
  }

  function loop(trigger) {
    let result = undefined;
    for (let i = 0; i < 48; i++) {
      const o = sideEffect(rhs);
      if (i === 3 && trigger) %OptimizeOsr();
      if (trigger && i === mutateAt) {
        Object.defineProperty(rhs, Symbol.hasInstance, {
          value() { return false; },
          configurable: true,
        });
      }
      result = o instanceof o;
    }
    return result;
  }

  %PrepareFunctionForOptimization(loop);
  assertEquals(expected, loop(false), `${name}/warm`);
  assertEquals(mutateAt === undefined ? expected : false, loop(true), `${name}/osr`);
}

function osrThrowCase(name, rhs) {
  function bar(v) {
    try {
      v.toString();
    } catch (e) {}
    return v;
  }

  function loop(trigger) {
    let result = "unset";
    for (let i = 0; i < 48; i++) {
      const o = bar(rhs);
      if (i === 3 && trigger) %OptimizeOsr();
      try {
        result = o instanceof o;
        fail(`${name}: expected TypeError`);
      } catch (e) {
        if (!(e instanceof TypeError)) throw e;
        result = "throws";
      }
    }
    return result;
  }

  %PrepareFunctionForOptimization(loop);
  assertEquals("throws", loop(false), `${name}/warm`);
  assertEquals("throws", loop(true), `${name}/osr`);
}

function returnsMarker(x) { return x.marker === 0x6161; }
function returnsObject() { return { truthy: true }; }
function returnsZero() { return 0; }

const boundTrue = returnsMarker.bind(null);
const proxyTrue = new Proxy(function(x) { return x.marker === 0x6161; }, {
  apply(target, thisArg, args) {
    return Reflect.apply(target, thisArg, args);
  },
});

directCase("own-jsfunction-bool", makeOwn("own-jsfunction-bool", returnsMarker), true);
directCase("own-jsfunction-object", makeOwn("own-jsfunction-object", returnsObject), true);
directCase("own-jsfunction-zero", makeOwn("own-jsfunction-zero", returnsZero), false);
directCase("own-bound-function", makeOwn("own-bound-function", boundTrue), true);
directCase("own-proxy-function", makeOwn("own-proxy-function", proxyTrue), true);
directThrowCase("own-noncallable", makeOwn("own-noncallable", {}));

{
  const protoCase = makeProto("proto-jsfunction", returnsMarker);
  directCase("proto-jsfunction", protoCase.rhs, true);
}

{
  const rhs = makeOwn("mutate-own-after-warmup-real", returnsMarker);
  directCase("mutate-own-after-warmup-real", rhs, true, function() {
    Object.defineProperty(rhs, Symbol.hasInstance, {
      value() { return false; },
      configurable: true,
    });
  });
}

{
  const protoCase = makeProto("mutate-proto-after-warmup", returnsMarker);
  directCase("mutate-proto-after-warmup", protoCase.rhs, true, function() {
    Object.defineProperty(protoCase.holder, Symbol.hasInstance, {
      value() { return false; },
      configurable: true,
    });
  });
}

osrCase("osr-own-jsfunction", makeOwn("osr-own-jsfunction", returnsMarker), true);
osrCase("osr-own-bound", makeOwn("osr-own-bound", boundTrue), true);
osrCase("osr-own-proxy", makeOwn("osr-own-proxy", proxyTrue), true);
osrThrowCase("osr-own-noncallable", makeOwn("osr-own-noncallable", {}));
osrCase("osr-mutate-midloop", makeOwn("osr-mutate-midloop", returnsMarker), true, 8);
