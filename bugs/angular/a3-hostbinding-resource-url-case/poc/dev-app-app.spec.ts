import {TestBed} from '@angular/core/testing';
import {App} from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
    });
  });

  it('renders an uppercase iframe with a plain string ResourceURL via host binding', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    const frame = fixture.nativeElement.querySelector('#poc-frame') as HTMLIFrameElement;
    expect(frame.getAttribute('src')).toBe('http://attacker.example/poc-frame.html');
  });
});
