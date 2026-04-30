# Evidence: A16 Browser `srcset` Impact

Date: 2026-04-29

Command:

```bash
node bugs/angular/a16-icu-attribute-normalization-srcset/poc/browser_srcset_impact_probe.mjs
```

Raw JSON:

```text
bugs/angular/a16-icu-attribute-normalization-srcset/evidence/2026-04-29-browser-srcset-impact.json
```

## Observed Requests

Chrome 147 requested:

```text
/probe.html
/source-1x.png
/safe.png
/event?done=1&messages=
/favicon.ico
```

Important headers for the `srcset` image fetches:

```text
sec-fetch-mode: no-cors
sec-fetch-dest: image
```

## DOM / Execution Result

The dumped DOM contained:

```html
<source srcset="http://127.0.0.1:53273/source-1x.png 1x">
<img id="img-srcset-js" srcset="/safe.png 1x, javascript:top.postMessage('srcset-js', '*') 2x">
```

The completion beacon was:

```text
/event?done=1&messages=
```

`messages` is empty, so the `javascript:` candidate in `srcset` did not execute.

## Interpretation

The browser impact of the residual `srcset` primitive is image/resource fetch only. No script
execution, navigation, credential leak, or cross-user behavior was observed.
