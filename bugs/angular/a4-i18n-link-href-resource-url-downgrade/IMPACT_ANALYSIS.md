# Impact Analysis

Date: 2026-04-28

## Bottom Line

This is a real Angular security-context mismatch, but not a strong standalone exploit in the tested
default-app shapes.

The bug breaks the invariant that `link|href` is a `ResourceURL` sink. Direct translated attribute
interpolation through `i18n-href` can render a plain attacker-controlled URL where normal Angular
bindings reject it. Browser validation confirmed network fetches for some `rel` modes. Browser
validation did not confirm JavaScript execution, credential exposure, or cross-user impact.

## What Is Confirmed

Confirmed by Angular acceptance-style tests:

- Normal `<link href="{{httpUrl}}">` rejects a plain string URL with `NG0904`.
- Normal `<link [href]="httpUrl">` rejects a plain string URL with `NG0904`.
- Normal `<link [attr.href]="httpUrl">` rejects a plain string URL with `NG0904`.
- `<div i18n><link href="{{httpUrl}}"></div>` rejects a plain string URL with `NG0904`.
- Direct `<link href="{{httpUrl}}" i18n-href>` renders the plain URL.

Confirmed by browser validation in a compiled Angular app:

- `rel="{{stylesheetRel}}"` plus `i18n-href` renders a remote stylesheet URL and Chrome fetches it.
- Static `rel=preload` plus `i18n-href` renders a remote JS URL and Chrome fetches it as preload.
- Static `rel=modulepreload` plus `i18n-href` renders a remote module URL and Chrome fetches it as
  modulepreload.

## What Is Not Confirmed

- No XSS.
- No script execution from `preload` or `modulepreload` alone.
- No SSRF.
- No credential leak.
- No cross-request or cross-user leak.
- No default static `rel=stylesheet` exploit: Angular's build pipeline rejects
  `<link rel="stylesheet" href="{{...}}" i18n-href>` with `NG2008`.

## Exploit Preconditions

An application would need all of the following:

1. A component template uses direct translated attribute interpolation on `link href`:
   `<link href="{{attackerValue}}" i18n-href>`.
2. The interpolated value is attacker-controlled or translation-controlled.
3. The `rel` mode creates a meaningful browser side effect.

For remote stylesheet loading, one additional condition was needed in the tested app:

4. `rel` is not statically visible as `stylesheet` to Angular's build-time stylesheet resolver, for
   example `rel="{{stylesheetRel}}"`.

That fourth condition matters. It means the obvious default developer shape is blocked, and the
remaining stylesheet shape requires either a dynamic `rel` or another path that hides `stylesheet`
from the compiler.

## Why This Is Not Currently VRP-Strong

The demonstrated browser impact is resource loading, not code execution. Remote CSS can affect UI
integrity, and `preload` / `modulepreload` can create network/cache side effects, but those require
a second primitive to become account compromise, data theft, or origin integrity loss.

The finding is therefore best classified as:

- `CONFIRMED-DOWNGRADE`: Angular violates its own `ResourceURL` contract.
- `CONFIRMED-BROWSER-FETCH`: Chrome fetches some rendered attacker URLs.
- `NOT-XSS`: no script execution observed.
- `CHAIN-PRIMITIVE`: useful only if chained with CSS UI redress, cache/preload confusion, CSP/TT
  policy bypass, or another app-specific impact.

## Severity Working Estimate

Standalone severity: Low.

Potential severity if chained:

- Medium if attacker CSS can create realistic UI integrity impact in a target app.
- Medium if `preload` / `modulepreload` can poison a cache or affect a later trusted import/fetch.
- High only if a chain produces script execution, credential exposure, or cross-user compromise.

## Threat Model Update

This updates S4, not by raising A4 to a primary exploit, but by refining the invariant:

Runtime i18n must preserve the full element-and-attribute security context, not only the attribute
name. Attribute-name-only sanitization is insufficient for sinks whose context differs by element,
such as `a|href` versus `link|href`.

Expansion rule for the next i18n pass:

- Treat every `SENSITIVE_ATTRS[attr]` runtime i18n path as suspect when the compiler schema has
  tag-specific contexts for the same attribute.
- Prioritize cases where browser behavior executes or leaks by default, not merely where Angular's
  internal context is inconsistent.

## Decision

Park A4 as a primitive and move to the next sink. Do not spend more time on A4 unless a concrete
chain target appears.

