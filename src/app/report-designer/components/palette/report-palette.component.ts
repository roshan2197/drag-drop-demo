import { Component, inject } from '@angular/core';

import { ElementKind } from '../../report-designer.models';
import { ReportStateService } from '../../services/report-state.service';

@Component({
  selector: 'app-report-palette',
  templateUrl: './report-palette.component.html',
  styleUrl: './report-palette.component.css',
})
export class ReportPaletteComponent {
  readonly state = inject(ReportStateService);

  startPaletteDrag(event: DragEvent, kind: ElementKind): void {
    event.dataTransfer?.setData('application/report-element', kind);
    event.dataTransfer?.setData('text/plain', kind);

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'copy';
    }
  }
}
