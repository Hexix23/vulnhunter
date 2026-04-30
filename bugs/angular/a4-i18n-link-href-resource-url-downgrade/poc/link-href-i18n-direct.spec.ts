import {Component} from '@angular/core';

@Component({
  template: '<link href="{{httpUrl}}" i18n-href>',
})
class App {
  httpUrl = 'http://attacker.example/poc.js';
}

// Expected:
//   NG0904, because link|href is SecurityContext.RESOURCE_URL.
//
// Observed in Angular acceptance harness:
//   <link href="http://attacker.example/poc.js">

