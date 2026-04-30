// Flags: --allow-natives-syntax --maglev --maglev-untagged-phis --expose-gc

function fail(msg) {
  throw new Error(msg);
}

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

function assertMaglev(fn, label) {
  if ((%GetOptimizationStatus(fn) & (1 << 4)) === 0) {
    fail(`${label}: function did not reach Maglev`);
  }
}

const H0 = %AllocateHeapNumberWithValue(42.0);
const H1 = %AllocateHeapNumberWithValue(7.0);
const object_value = {
  payload: 0x1234,
  m() { return 0x5151; },
  toString() { return "object-path"; },
};
const arr = [null];
const arr2 = [null];
const holder = { x: object_value };
const holder2 = { x: object_value };
const map = new Map();

function churn() {
  for (let i = 0; i < 2000; i++) ({ i, j: i + 1 });
}

function makeV(c) {
  let phi1 = c ? H0 : H1;
  phi1 + 1;
  let v = c ? object_value : phi1;
  arr[0] = v;
  return v;
}

const cases = [
  {
    name: "array-only-return",
    f(c) {
      let v = makeV(c);
      return arr[0] === v ? (typeof arr[0]) : "mismatch";
    },
    trueExpected: "object",
    falseExpected: "number",
  },
  {
    name: "field-after-array",
    f(c) {
      let v = makeV(c);
      holder.x = v;
      return typeof holder.x;
    },
    trueExpected: "object",
    falseExpected: "number",
  },
  {
    name: "array-after-field",
    f(c) {
      let v = makeV(c);
      holder.x = v;
      arr2[0] = v;
      return typeof arr2[0];
    },
    trueExpected: "object",
    falseExpected: "number",
  },
  {
    name: "two-field-stores",
    f(c) {
      let v = makeV(c);
      holder.x = v;
      holder2.x = v;
      return typeof holder2.x;
    },
    trueExpected: "object",
    falseExpected: "number",
  },
  {
    name: "array-push",
    f(c) {
      let v = makeV(c);
      const local = [];
      local.push(v);
      return typeof local[0];
    },
    trueExpected: "object",
    falseExpected: "number",
  },
  {
    name: "property-load",
    f(c) {
      let v = makeV(c);
      return v.payload + 1;
    },
    trueExpected: 0x1235,
    falseExpected: NaN,
  },
  {
    name: "method-call",
    f(c) {
      let v = makeV(c);
      return v.m();
    },
    trueExpected: 0x5151,
    falseThrows: true,
  },
  {
    name: "reflect-get-prototype",
    f(c) {
      let v = makeV(c);
      return Reflect.getPrototypeOf(v) === Object.prototype;
    },
    trueExpected: true,
    falseThrows: true,
  },
  {
    name: "instanceof",
    f(c) {
      let v = makeV(c);
      return v instanceof function C() {};
    },
    trueExpected: false,
    falseExpected: false,
  },
  {
    name: "map-set-get",
    f(c) {
      let v = makeV(c);
      map.set("k", v);
      return typeof map.get("k");
    },
    trueExpected: "object",
    falseExpected: "number",
  },
  {
    name: "gc-between-array-and-field",
    f(c) {
      let v = makeV(c);
      if (!c) gc();
      churn();
      holder.x = v;
      return typeof holder.x;
    },
    trueExpected: "object",
    falseExpected: "number",
  },
];

for (const test of cases) {
  const f = test.f;
  %PrepareFunctionForOptimization(f);
  assertEquals(test.trueExpected, f(true), `${test.name}/warm1`);
  assertEquals(test.trueExpected, f(true), `${test.name}/warm2`);

  %OptimizeMaglevOnNextCall(f);
  assertEquals(test.trueExpected, f(true), `${test.name}/opt`);
  assertMaglev(f, test.name);

  if (test.falseThrows) {
    assertThrows(() => f(false), `${test.name}/trigger`);
  } else {
    assertEquals(test.falseExpected, f(false), `${test.name}/trigger`);
  }
}
