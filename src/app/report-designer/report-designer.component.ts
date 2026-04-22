import { Component, HostListener, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ReportCanvasComponent } from './components/canvas/report-canvas.component';
import { ReportInspectorComponent } from './components/inspector/report-inspector.component';
import { ReportPaletteComponent } from './components/palette/report-palette.component';
import { PdfExportService } from './services/pdf-export.service';
import { ReportStateService } from './services/report-state.service';

@Component({
  selector: 'app-report-designer',
  imports: [FormsModule, ReportPaletteComponent, ReportCanvasComponent, ReportInspectorComponent],
  templateUrl: './report-designer.component.html',
  styleUrls: ['./report-designer.component.css'],
})
export class ReportDesignerComponent {
  readonly state = inject(ReportStateService);
  private readonly pdfExport = inject(PdfExportService);

  exportPdf(): void {
    void this.pdfExport.export(this.state.report());
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboard(event: KeyboardEvent): void {
    if (this.isTyping(event)) {
      return;
    }

    const isCmd = event.ctrlKey || event.metaKey;
    const selected = this.state.selectedElement();

    if (isCmd && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) {
        this.state.redo();
      } else {
        this.state.undo();
      }
      return;
    }

    if (isCmd && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      this.state.redo();
      return;
    }

    if (!selected) {
      return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.state.deleteSelected();
      return;
    }

    const step = event.shiftKey ? 16 : 1;
    const movement: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = movement[event.key];

    if (!delta) {
      return;
    }

    event.preventDefault();
    this.state.moveElement(selected.id, selected.x + delta[0], selected.y + delta[1]);
  }

  private isTyping(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement | null;
    return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '');
  }
}
