import { Component } from '@angular/core';

import { ReportDesignerComponent } from './report-designer/report-designer.component';

@Component({
  selector: 'app-root',
  imports: [ReportDesignerComponent],
  templateUrl: './app.html',
  styleUrls: ['./app.css'],
})
export class App {}
