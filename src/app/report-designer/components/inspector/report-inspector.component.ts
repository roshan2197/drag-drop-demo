import { CommonModule } from '@angular/common';
import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { InspectorTab, PagePreset, ReportElement, TableOption } from '../../report-designer.models';
import { ReportStateService } from '../../services/report-state.service';

@Component({
  selector: 'app-report-inspector',
  imports: [CommonModule, FormsModule],
  templateUrl: './report-inspector.component.html',
  styleUrl: './report-inspector.component.css',
})
export class ReportInspectorComponent {
  readonly state = inject(ReportStateService);
  readonly activeTab = signal<InspectorTab>('element');
  readonly pagePresets: PagePreset[] = ['A4', 'Letter', 'Custom'];

  constructor() {
    effect(() => {
      const selected = this.state.selectedElement();

      if (!selected) {
        this.activeTab.set('page');
      } else {
        this.activeTab.set('element');
      }
    });
  }

  setTab(tab: InspectorTab): void {
    if (tab === 'element' && !this.state.selectedElement()) {
      this.activeTab.set('page');
      return;
    }

    if (tab === 'data' && this.state.selectedElement()?.kind !== 'table') {
      this.activeTab.set('element');
      return;
    }

    this.activeTab.set(tab);
  }

  update(element: ReportElement, patch: Partial<ReportElement>): void {
    this.state.updateElement(element.id, patch);
  }

  updateNumber(
    element: ReportElement,
    key: 'x' | 'y' | 'width' | 'height' | 'fontSize' | 'radius',
    value: number,
  ): void {
    this.state.updateElementNumber(element.id, key, value);
  }

  updatePageNumber(key: 'width' | 'height' | 'margin' | 'bleed', value: number): void {
    this.state.updatePage({ [key]: Number(value) });
  }

  toggleTableOption(element: ReportElement, option: TableOption): void {
    this.state.toggleTableOption(element.id, option);
  }

  importJson(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    void this.state.importJson(file);
    input.value = '';
  }
}
