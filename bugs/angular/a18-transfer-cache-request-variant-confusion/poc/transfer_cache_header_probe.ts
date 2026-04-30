// Temporary probe intended for packages/common/http/test/transfer_cache_spec.ts.
// Do not leave this inside the Angular checkout after collecting evidence.

it('should cache a GET carrying Cookie by default and replay it to a same-URL request without Cookie', () => {
  makeRequestAndExpectOne('/profile', 'alice-private', {
    headers: {Cookie: 'sid=alice'},
  });

  const response = makeRequestAndExpectNone('/profile');
  expect(response.body).toBe('alice-private');
});

it('should replay a default GET across non-auth request header variants', () => {
  makeRequestAndExpectOne('/tenant-data', 'tenant-a-private', {
    headers: {'X-Tenant': 'tenant-a'},
  });

  const response = makeRequestAndExpectNone('/tenant-data', 'GET', {
    headers: {'X-Tenant': 'tenant-b'},
  });

  expect(response.body).toBe('tenant-a-private');
});

it('should ignore response Vary when replaying same-URL requests across request header variants', () => {
  TestBed.inject(HttpClient)
    .get('/vary-tenant', {headers: {'X-Tenant': 'tenant-a'}, observe: 'response'})
    .subscribe();
  TestBed.inject(HttpTestingController)
    .expectOne('/vary-tenant')
    .flush('tenant-a-private', {headers: {Vary: 'X-Tenant'}});

  const response = makeRequestAndExpectNone('/vary-tenant', 'GET', {
    headers: {'X-Tenant': 'tenant-b'},
  });

  expect(response.body).toBe('tenant-a-private');
});

it('should transfer but not honor Vary when includeHeaders contains Vary', () => {
  TestBed.inject(HttpClient)
    .get('/vary-transferred', {
      headers: {'X-Tenant': 'tenant-a'},
      observe: 'response',
      transferCache: {includeHeaders: ['Vary']},
    })
    .subscribe();
  TestBed.inject(HttpTestingController)
    .expectOne('/vary-transferred')
    .flush('tenant-a-private', {headers: {Vary: 'X-Tenant'}});

  const response = makeRequestAndExpectNone('/vary-transferred', 'GET', {
    headers: {'X-Tenant': 'tenant-b'},
    transferCache: {includeHeaders: ['Vary']},
  });

  expect(response.headers.get('Vary')).toBe('X-Tenant');
  expect(response.body).toBe('tenant-a-private');
});

it('should cache a no-store response and replay it from TransferState', () => {
  TestBed.inject(HttpClient).get('/no-store-private').subscribe();
  TestBed.inject(HttpTestingController)
    .expectOne('/no-store-private')
    .flush('private-body', {headers: {'Cache-Control': 'private, no-store'}});

  const response = makeRequestAndExpectNone('/no-store-private');
  expect(response.body).toBe('private-body');
});

it('should transfer but not honor Cache-Control no-store when includeHeaders contains Cache-Control', () => {
  TestBed.inject(HttpClient)
    .get('/no-store-transferred', {
      observe: 'response',
      transferCache: {includeHeaders: ['Cache-Control']},
    })
    .subscribe();
  TestBed.inject(HttpTestingController)
    .expectOne('/no-store-transferred')
    .flush('private-body', {headers: {'Cache-Control': 'private, no-store'}});

  const response = makeRequestAndExpectNone('/no-store-transferred', 'GET', {
    transferCache: {includeHeaders: ['Cache-Control']},
  });

  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(response.body).toBe('private-body');
});

it('should replay across distinct URLs with the same 32-bit transfer cache hash', () => {
  // Both strings hash to StateKey "2930238366" under transfer_cache.ts generateHash():
  // GET|text|/collision/4du1y3wwrg||
  // GET|text|/collision/xjb04p9--8||
  let firstResponse!: string;
  TestBed.inject(HttpClient)
    .get('/collision/4du1y3wwrg', {responseType: 'text'})
    .subscribe((response) => (firstResponse = response));
  TestBed.inject(HttpTestingController)
    .expectOne('/collision/4du1y3wwrg')
    .flush('first-colliding-url');
  expect(firstResponse).toBe('first-colliding-url');

  let secondResponse!: string;
  TestBed.inject(HttpClient)
    .get('/collision/xjb04p9--8', {responseType: 'text'})
    .subscribe((response) => (secondResponse = response));
  TestBed.inject(HttpTestingController).expectNone('/collision/xjb04p9--8');
  expect(secondResponse).toBe('first-colliding-url');
});

it('should replay a cookie-bearing server response during browser hydration', () => {
  TestBed.inject(HttpClient)
    .get('/profile', {headers: new HttpHeaders({Cookie: 'sid=alice'})})
    .subscribe();
  TestBed.inject(HttpTestingController).expectOne('/profile').flush('alice-private');

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
    .get('/profile')
    .subscribe((r) => (hydratedResponse = r));

  TestBed.inject(HttpTestingController).expectNone('/profile');
  expect(hydratedResponse).toBe('alice-private');
});
