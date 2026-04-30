# Evidence - Angular XSRF relative URL classification

Date: 2026-04-28

Temporary test added to:

```text
packages/common/http/test/xsrf_spec.ts
```

Probe:

```ts
it('applies XSRF protection to relative request forms without considering document base href', () => {
  for (const url of ['api', '/api', './api', '../api']) {
    interceptor.intercept(new HttpRequest('POST', url, {}), backend).subscribe();
    const req = backend.expectOne(url);
    expect(req.request.headers.get('X-XSRF-TOKEN')).toEqual('test');
    req.flush({});
  }
});
```

Command:

```bash
orb -m ubuntu -u root chroot --userspec=carlosgomez:carlosgomez /mnt/machines/angularvm /usr/bin/env HOME=/home/carlosgomez USER=carlosgomez LOGNAME=carlosgomez PATH=/usr/local/bin:/usr/bin:/bin:/opt/node-v22.22.2/bin pnpm --dir /home/carlosgomez/angular exec bazelisk test //packages/common/http/test:test --test_filter='HttpXsrfInterceptor applies XSRF protection to relative request forms'
```

Result:

```text
INFO: Build completed successfully, 5 total actions
//packages/common/http/test:test                                         PASSED in 3.8s

Executed 1 out of 1 test: 1 test passes.
```

