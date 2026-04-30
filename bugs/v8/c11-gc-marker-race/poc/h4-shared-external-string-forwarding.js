// C11-H4: shared external string forwarding table entries across async GC.
// Based on a 2025 shared-memory regression shape, run here under stress
// marking to look for marker/forwarding-table lifetime confusion.

function assertEq(got, expected, label) {
  if (got !== expected) {
    throw new Error(label + ": got " + got + ", expected " + expected);
  }
}

function getString2() {
  return "madness";
}

function getString() {
  return createExternalizableString("this" + "is" + getString2());
}

function make_dead_forwarding_entry() {
  let str_shared = %ShareObject(getString());
  str_shared[str_shared] = true;
  externalizeString(str_shared);
}

function make_live_forwarded_string() {
  let str_shared_int = %ShareObject(getString());
  str_shared_int[str_shared_int] = true;
  return str_shared_int;
}

async function main() {
  for (let i = 0; i < 64; i++) {
    make_dead_forwarding_entry();
    let live = make_live_forwarded_string();
    await gc({execution: "async"});
    let lookup = "this" + "is" + "madness";
    let obj = {"thisismadness": "indeed"};
    assertEq(obj[lookup], "indeed", "lookup after async gc");
    if ((i & 7) === 0) %SharedGC();
    // Keep the live forwarded shared string observable.
    assertEq(String(live), "thisismadness", "live forwarded string");
  }
  print("OK");
}

main();
