import { Component, REQUEST, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of } from 'rxjs';

@Component({
  selector: 'app-root',
  imports: [],
  template: `<pre id="result">{{ result() }}</pre>`,
})
export class App {
  private readonly request = inject(REQUEST, { optional: true });
  private readonly http = inject(HttpClient);

  protected readonly result = (() => {
    if (!this.request) return signal('no-request');
    const raw = this.request.headers.get('x-forwarded-host');
    if (!raw) return signal('no-xfh');

    let target: string;
    try {
      const parsed = new URL('http://' + raw);
      target = `${parsed.protocol}//${parsed.host}/probe`;
    } catch (e) {
      return signal('URL_ERR=' + (e as Error).message);
    }

    return toSignal(
      this.http.get(target, { responseType: 'text' }).pipe(
        map((body) => `FETCH=${target}|BODY=${body}`),
        catchError((e) => of(`FETCH=${target}|ERR=${String(e).slice(0, 120)}`)),
      ),
      { initialValue: `FETCH=${target}|pending` },
    );
  })();
}
