# V8 C13 Slice - Temporal Spec Differential

**Date:** 2026-04-27
**Candidate:** `C13.S7`
**Surface:** Temporal API (`B2 + B4`)
**Violated contract:** Temporal string/object conversion paths must reject malformed or contradictory calendar metadata and must preserve spec-equivalent behavior across constructor and Intl integration paths.

## Working set

- `src/objects/js-temporal-objects.cc:2614-2633`
  `Temporal.PlainDate.from(string)` delegates parsed-string handling to `temporal_rs::ParsedDate::from_utf8/from_utf16`.
- `src/objects/js-temporal-objects.cc:2735-2747`
  `Temporal.PlainDateTime.from(string)` delegates to `temporal_rs::ParsedDateTime::from_utf8/from_utf16`.
- `src/objects/js-temporal-objects.cc:3116-3127`
  `Temporal.PlainMonthDay.from(string)` delegates month-day parsing to Rust helpers.
- `src/objects/js-temporal-objects.cc:2011-2046`
  `PrepareCalendarFields` hardcodes calendar-carrying behavior not explicit in the spec and contains calendar-specific era assumptions.
- `src/objects/js-temporal-objects.cc:2252-2331`
  `ToTemporalDurationRust` / `ToTemporalDurationAsRecord` bridge Temporal duration values into `Intl.DurationFormat`.
- `src/objects/js-duration-format.cc:1122-1243`
  `Intl.DurationFormat` formats by converting through `ToTemporalDurationAsRecord`, then ICU formatting.

## Hypotheses

1. **H1 - duplicate calendar annotations generalize beyond `PlainDate`**
   The already-confirmed `PlainDate` parser confusion likely exists in sibling string constructors that use the same Rust parsing family.

2. **H2 - critical calendar annotations are mishandled**
   The Rust parser may silently normalize or discard contradictory `!u-ca=` / `u-ca=` combinations instead of throwing.

3. **H3 - non-Gregorian era handling diverges on object paths**
   `PrepareCalendarFields` bakes in `calendarUsesEras` assumptions and carries `calendar` through `CombinedRecord`, which may accept or reject era-bearing field sets incorrectly for some calendars.

4. **H4 - `Temporal.Duration.prototype.toLocaleString` and `Intl.DurationFormat` diverge on edge duration inputs**
   The bridge through `ToTemporalDurationRust` and conversion back to doubles may create string/object or Temporal/Intl accept-reject mismatches near sign and range boundaries.

## Initial probes

- `h1.js` - duplicate calendar annotations across multiple Temporal string constructors.
- `h2.js` - critical calendar annotation combinations.
- `h3.js` - `DurationFormat` equivalence and reject behavior on edge duration inputs.
