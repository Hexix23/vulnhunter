import { Component, inject, REQUEST, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterOutlet } from '@angular/router';
import { catchError, map, of } from 'rxjs';

type ProbeResult = {
  requestUrl: string;
  target: string;
  body?: string;
  error?: string;
};

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly title = signal('c9-authority');
  private readonly request = inject(REQUEST, { optional: true });
  private readonly http = inject(HttpClient);

  protected readonly probe = toSignal(this.runProbe(), {
    initialValue: { requestUrl: '', target: '', body: 'pending' } as ProbeResult,
  });

  private runProbe() {
    const requestUrl = this.request?.url ?? '';
    if (!requestUrl) {
      return of({ requestUrl, target: '', body: 'no-request-token' } as ProbeResult);
    }
    const parsed = new URL(requestUrl);
    const target = `${parsed.protocol}//${parsed.host}/probe`;
    return this.http.get(target, { responseType: 'text' }).pipe(
      map((body) => ({ requestUrl, target, body }) as ProbeResult),
      catchError((err) => of({ requestUrl, target, error: String(err?.message ?? err) } as ProbeResult)),
    );
  }
}
