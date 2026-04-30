import { Component, REQUEST, inject } from '@angular/core';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  auth = inject(REQUEST, { optional: true })?.headers.get('Authorization') ?? 'NONE';
}
