# C13 Walkthrough

This round opened `C13` using the compact threat model and a single slice document.

## What was read

- `docs/threat-models/2026-04-27-v8-minimal-threat-model.md`
- `docs/threat-models/2026-04-26-v8-invariants-and-hunt-matrix.md` (`C13.S7`)
- `src/objects/js-temporal-objects.cc`
- `src/objects/js-duration-format.cc`

## Why these code paths

- `js-temporal-objects.cc:2614-2633` already hosted the prior `PlainDate` duplicate-calendar finding.
- Sibling constructors (`PlainDateTime`, `ZonedDateTime`-related parsing) use the same Rust parsing family.
- `js-duration-format.cc` plus `ToTemporalDurationAsRecord` was the most likely `Intl x Temporal` divergence point for `C15`-style follow-on signal.

## Round results

1. Duplicate non-critical calendar annotations were downgraded after reading
   local test262. Secondary non-critical calendar annotations may be ignored.
2. Critical duplicate calendar handling appears correct in tested cases.
3. Era-bearing object paths did not show a new divergence in the tested Japanese/Gregorian cases; inconsistent year combinations throw as they should.
4. `DurationFormat` edge formatting behaved consistently in the tested object/string and Temporal/Intl pairings.
5. `MonthDay` and `YearMonth` duplicate-calendar probes did not reproduce the same primitive because the tested non-ISO forms are rejected earlier.
6. Round 2 H5-H12 added annotation entrypoints, ZonedDateTime offset conflicts,
   era support matrix, getter order, DurationFormat precision, and Intl
   DateTimeFormat Temporal era/default-format.
7. H12 reproduced a known test262/status failure: era-only formatting returns
   just `A` instead of default date/time formatting with era.

## Next best follow-ups

1. Do not keep spending on duplicate non-critical annotations.
2. If continuing Temporal, use test262/status-driven sinks:
   - `DateTimeFormat` Temporal `hourCycle`;
   - `dateStyle` adjustment;
   - formatter state pollution after Plain* formatting;
   - non-ISO calendar mismatch/alias behavior.
3. H12 is known to Google (`b/463427743`), so only variants outside status are
   worth pursuing.
