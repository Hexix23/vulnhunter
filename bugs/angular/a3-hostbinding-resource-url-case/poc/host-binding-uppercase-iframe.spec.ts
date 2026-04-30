// Drop-in regression PoC for:
// packages/core/test/acceptance/host_binding_spec.ts
//
// The lowercase control exercises the intended ResourceURL policy.
// The uppercase element exercises the observed downgrade: the host binding
// runtime passes tNode.value into sanitizeUrlOrResourceUrl, while
// getUrlSanitizer() compares tag and attribute names case-sensitively.

it('requires ResourceUrl for lowercase iframe src host bindings', () => {
  @Directive({
    selector: '[unsafeResourceUrlHostBindingDir]',
    host: {'[attr.src]': 'value'},
    standalone: false,
  })
  class UnsafeResourceUrlDir {
    value: any = 'http://server';
  }

  @Component({
    template: `<iframe unsafeResourceUrlHostBindingDir></iframe>`,
    standalone: false,
    changeDetection: ChangeDetectionStrategy.Eager,
  })
  class App {
    @ViewChild(UnsafeResourceUrlDir) unsafeDir!: UnsafeResourceUrlDir;
  }

  TestBed.configureTestingModule({declarations: [App, UnsafeResourceUrlDir]});
  const fixture = TestBed.createComponent(App);

  expect(() => fixture.detectChanges()).toThrowError(/unsafe value used in a resource URL/);
});

it('downgrades ResourceUrl iframe src host bindings on uppercase elements', () => {
  @Directive({
    selector: '[unsafeResourceUrlHostBindingDir]',
    host: {'[attr.src]': 'value'},
    standalone: false,
  })
  class UnsafeResourceUrlDir {
    value: any = 'http://server';
  }

  @Component({
    template: `<IFRAME unsafeResourceUrlHostBindingDir></IFRAME>`,
    standalone: false,
    changeDetection: ChangeDetectionStrategy.Eager,
  })
  class App {}

  TestBed.configureTestingModule({declarations: [App, UnsafeResourceUrlDir]});
  const fixture = TestBed.createComponent(App);
  fixture.detectChanges();

  const iframe = fixture.nativeElement.querySelector('iframe')!;
  expect(iframe.getAttribute('src')).toEqual('http://server');
});

it('downgrades ResourceUrl iframe src host bindings on uppercase attributes', () => {
  @Directive({
    selector: '[unsafeResourceUrlHostBindingDir]',
    host: {'[attr.SRC]': 'value'},
    standalone: false,
  })
  class UnsafeResourceUrlDir {
    value: any = 'http://server';
  }

  @Component({
    template: `<iframe unsafeResourceUrlHostBindingDir></iframe>`,
    standalone: false,
    changeDetection: ChangeDetectionStrategy.Eager,
  })
  class App {}

  TestBed.configureTestingModule({declarations: [App, UnsafeResourceUrlDir]});
  const fixture = TestBed.createComponent(App);
  fixture.detectChanges();

  const iframe = fixture.nativeElement.querySelector('iframe')!;
  expect(iframe.getAttribute('src')).toEqual('http://server');
});
