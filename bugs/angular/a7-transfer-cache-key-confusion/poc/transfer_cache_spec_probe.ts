// Temporary probe inserted into packages/common/http/test/transfer_cache_spec.ts.
// This is not meant to remain in the Angular checkout.

it('should expose transfer cache key confusion across URL and POST body separators', () => {
  makeRequestAndExpectOne('/api|x', 'first-response', {
    method: 'POST',
    transferCache: true,
    body: 'y',
  });

  const response = makeRequestAndExpectNone('/api', 'POST', {
    transferCache: true,
    body: 'x|y',
  });

  expect(response.body).toBe('first-response');
});

it('should expose transfer cache key confusion across HttpParams value multiplicity', () => {
  let firstResponse!: Object;
  TestBed.inject(HttpClient)
    .get('/query', {params: new HttpParams({fromObject: {a: '1,2'}})})
    .subscribe((r) => (firstResponse = r));
  TestBed.inject(HttpTestingController).expectOne('/query?a=1,2').flush('single-comma');
  expect(firstResponse).toBe('single-comma');

  let secondResponse!: Object;
  TestBed.inject(HttpClient)
    .get('/query', {params: new HttpParams({fromObject: {a: ['1', '2']}})})
    .subscribe((r) => (secondResponse = r));
  TestBed.inject(HttpTestingController).expectNone('/query?a=1&a=2');

  expect(secondResponse).toBe('single-comma');
});

it('should expose transfer cache key confusion during browser hydration', () => {
  TestBed.inject(HttpClient)
    .get('/query', {params: new HttpParams({fromObject: {a: '1,2'}})})
    .subscribe();
  TestBed.inject(HttpTestingController).expectOne('/query?a=1,2').flush('server-response');

  const transferState = TestBed.inject(TransferState);

  TestBed.resetTestingModule();
  document.body.innerHTML = '<test-app-http></test-app-http>';
  isStable = new BehaviorSubject<boolean>(false);

  @Injectable()
  class ApplicationRefPatched extends ApplicationRef {
    override get isStable() {
      return isStable;
    }
  }

  TestBed.configureTestingModule({
    declarations: [SomeComponent],
    providers: [
      {provide: PLATFORM_ID, useValue: PLATFORM_BROWSER_ID},
      {provide: DOCUMENT, useFactory: () => document},
      {provide: ApplicationRef, useClass: ApplicationRefPatched},
      {provide: TransferState, useValue: transferState},
      withHttpTransferCache({}),
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  });

  const appRef = TestBed.inject(ApplicationRef);
  appRef.bootstrap(SomeComponent);

  let hydratedResponse!: Object;
  TestBed.inject(HttpClient)
    .get('/query', {params: new HttpParams({fromObject: {a: ['1', '2']}})})
    .subscribe((r) => (hydratedResponse = r));

  TestBed.inject(HttpTestingController).expectNone('/query?a=1&a=2');
  expect(hydratedResponse).toBe('server-response');
});

