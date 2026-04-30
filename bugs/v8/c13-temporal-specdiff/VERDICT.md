# C13/C15 Temporal Verdict

Date: 2026-04-28

Target:

- `src/objects/js-temporal-objects.cc`
- `src/objects/js-duration-format.cc`
- `src/objects/js-date-time-format.cc`

## Correction

The earlier H1 duplicate non-critical calendar annotation finding is downgraded
to `NOT-A-BUG`.

Local test262 has this explicit oracle:

- `test/test262/data/test/built-ins/Temporal/PlainDate/from/argument-string-calendar-annotation.js`
- `test/test262/data/test/built-ins/Temporal/PlainDateTime/from/argument-string-calendar-annotation.js`
- `test/test262/data/test/built-ins/Temporal/PlainTime/from/argument-string-calendar-annotation.js`
- `test/test262/data/test/built-ins/Temporal/Instant/*/argument-string-calendar-annotation.js`

Those tests say non-critical duplicate/second calendar annotations can be
ignored, and critical calendar annotations can be ignored in non-calendared
entrypoints. Multiple calendar annotations are invalid only if any has the
critical flag.

That means previous examples like:

```js
Temporal.PlainDate.from("2020-01-01[u-ca=gregory][u-ca=iso8601]")
```

are not VRP signal by themselves.

## H1 - duplicate non-critical calendar annotations

Status: `NOT-A-BUG / DOWNGRADED`.

Evidence:

- `evidence/h1.txt`
- `evidence/h1b.txt`

Reason: behavior matches local test262 semantics for ignored non-critical
secondary annotations.

## H2 - critical duplicate calendar annotation handling

Status: `REFUTED`.

Evidence:

- `evidence/h2.txt`
- `evidence/h11-release.txt`
- `evidence/h11-asan.txt`

Observed:

- PlainDate, PlainDateTime, ZonedDateTime critical duplicates throw.
- PlainTime and Instant exact test262 critical-duplicate shapes throw.

## H3 - non-Gregorian era object-path divergence

Status: `REFUTED / INCONCLUSIVE for unsupported calendar aliases`.

Evidence:

- `evidence/h4.txt`
- `evidence/h7-release.txt`
- `evidence/h7-asan.txt`

Observed:

- Japanese/Gregorian consistent era fields normalize.
- contradictory `year` vs `eraYear` throws.
- Chinese/Dangi era fields throw because those calendars are excluded from era
  support in `PrepareCalendarFields`.
- Some calendar aliases such as `islamic` are not accepted by the Temporal
  calendar parser in this path.

No memory-safety or VRP-grade signal.

## H4 - DurationFormat Temporal/Intl edge equivalence

Status: `REFUTED`.

Evidence:

- `evidence/h3.txt`
- `evidence/h9-release.txt`
- `evidence/h9-asan.txt`

Observed:

- `Intl.DurationFormat` and `Temporal.Duration.prototype.toLocaleString` match
  on tested edge values.
- duration seconds above `9007199254740991` are rejected before
  int64-to-double precision loss can occur in `ToTemporalDurationAsRecord`.

## H5 - unknown/duplicate annotations

Status: `REFUTED / LOW-SIGNAL`.

Evidence:

- `evidence/h5-release.txt`
- `evidence/h5-asan.txt`

Observed:

- unknown non-critical annotations are ignored.
- unknown critical annotations throw.
- duplicate non-critical unknown annotations are ignored.
- duplicate `u-tz` annotations are ignored.

This matches the ignored-annotation model unless a critical recognized duplicate
is present.

## H6 - ZonedDateTime offset/time-zone conflicts

Status: `REFUTED`.

Evidence:

- `evidence/h6-release.txt`
- `evidence/h6-asan.txt`

Observed:

- string and object conflict behavior matched across `offset` options.
- DST gap disambiguation produced distinct expected results and `reject`
  threw.

No mismatch between string and object paths.

## H7 - PrepareCalendarFields era support matrix

Status: `REFUTED / INCONCLUSIVE for calendar alias policy`.

Evidence:

- `evidence/h7-release.txt`
- `evidence/h7-asan.txt`

Source risk:

- `js-temporal-objects.cc:2031-2037` hardcodes era support as all calendars
  except `iso`, `chinese`, and `dangi`.

Observed behavior did not produce a clear spec/security divergence.

## H8 - calendar field getter order

Status: `REFUTED`.

Evidence:

- `evidence/h8-release.txt`
- `evidence/h8-asan.txt`

Observed getter order:

```text
PlainDate: day,month,monthCode,year
ZDT: day,hour,microsecond,millisecond,minute,month,monthCode,nanosecond,offset,second,timeZone,year
```

This is lexicographic and matches the comment in `PrepareCalendarFields`.

## H9 - DurationFormat precision above safe integer

Status: `REFUTED`.

Evidence:

- `evidence/h9-release.txt`
- `evidence/h9-asan.txt`

Observed:

- `9007199254740991` accepted and formatted.
- `9007199254740992+` rejected as invalid duration.

No precision-loss formatting primitive observed.

## H10/H11 - additional annotation entrypoints

Status: `REFUTED`.

Evidence:

- `evidence/h10-release.txt`
- `evidence/h10-asan.txt`
- `evidence/h11-release.txt`
- `evidence/h11-asan.txt`

Observed:

- PlainTime single critical calendar annotation accepted, consistent with
  test262's "critical flag has no effect" for this path.
- Instant single critical calendar annotation accepted, also consistent.
- multiple critical calendar annotations throw.
- duplicate timezone brackets throw.

## H12 - Intl.DateTimeFormat x Temporal era/default-format

Status: `CONFIRMED-KNOWN-FAILURE`.

Evidence:

- `evidence/h12-release.txt`
- `evidence/h12-asan.txt`

Observed:

```text
Date era baseline: OK 1/1/1970 A, 1:00:00 AM
Instant toLocaleString era: OK A
PlainDate toLocaleString era: OK A
DTF format PlainDate era: OK A
DTF formatToParts PlainDate era: OK era=A
DTF formatRange PlainDate era: OK A
```

Expected from local test262 status/comment:

- `test/test262/test262.status:262-267`
- comment: "toLocaleString with just an era setting should format as default"
- tracked internally as `b/463427743`.

This is a real implementation bug, but not new to Google and likely low/severe
logic correctness, not VRP-grade security.

Adjacent probes:

- `ignore timezone` variants in H12 produced expected local-time output.
- formatter state after PlainDateTime did not corrupt later Instant formatting.

## Overall

No new VRP-grade Temporal bug confirmed in this round.

Important cleanup: C13 duplicate calendar annotations should no longer be
counted as a confirmed primitive unless a future oracle proves a narrower
critical/recognized duplicate case.

Preserved signal:

- H12 era/default-format is a confirmed known test262 failure.
- It is useful as a sink class for variants, but not a submission candidate as
  currently observed.

