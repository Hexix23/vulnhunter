import { AsyncPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { catchError, map, of } from 'rxjs';

@Component({
  selector: 'app-root',
  imports: [AsyncPipe],
  template: `<pre id="secret">{{ secret$ | async }}</pre>`,
})
export class App {
  private readonly http = inject(HttpClient);

  readonly secret$ = this.http
    .get('/api/internal', { responseType: 'text' })
    .pipe(
      map((r) => `API_RESPONSE=${r}`),
      catchError((e) => of(`API_ERROR=${String(e)}`)),
    );
}
