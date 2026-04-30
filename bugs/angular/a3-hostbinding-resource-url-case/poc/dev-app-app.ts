import {Component, Directive, Input, signal} from '@angular/core';
import {RouterOutlet} from '@angular/router';

@Directive({
  selector: '[appUnsafeFrameSrc]',
  host: {'[attr.src]': 'url'},
})
export class UnsafeFrameSrcDirective {
  @Input('appUnsafeFrameSrc') url = '';
}

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, UnsafeFrameSrcDirective],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly title = signal('dev-app');
  protected readonly attackerFrameUrl = 'http://attacker.example/poc-frame.html';
}
