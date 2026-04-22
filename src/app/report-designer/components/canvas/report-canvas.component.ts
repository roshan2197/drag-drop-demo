import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  ActiveDrag,
  ElementKind,
  MeasurementGuide,
  ReportElement,
  ResizeHandle,
  SnapGuide,
} from '../../report-designer.models';
import { ReportStateService } from '../../services/report-state.service';

interface CanvasRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DragBadge {
  x: number;
  y: number;
  text: string;
}

@Component({
  selector: 'app-report-canvas',
  imports: [CommonModule, FormsModule],
  templateUrl: './report-canvas.component.html',
  styleUrl: './report-canvas.component.css',
})
export class ReportCanvasComponent {
  @ViewChild('pageCanvas') private pageCanvas?: ElementRef<HTMLElement>;

  readonly state = inject(ReportStateService);
  readonly snapGuides = signal<SnapGuide[]>([]);
  readonly measurementGuides = signal<MeasurementGuide[]>([]);
  readonly dragBadge = signal<DragBadge | null>(null);

  private readonly snapThreshold = 6;
  private activeDrag: ActiveDrag | null = null;

  elementStyle(element: ReportElement): Record<string, string> {
    return {
      left: `${element.x}px`,
      top: `${element.y}px`,
      width: `${element.width}px`,
      height: `${element.height}px`,
      color: element.color,
      background: element.background,
      'font-size': `${element.fontSize}px`,
      'font-weight': element.bold ? '700' : '500',
      'text-align': element.align,
      'border-radius': `${element.radius}px`,
      'border-color': element.border ? '#d8e0ee' : 'transparent',
    };
  }

  metricParts(text: string): { value: string; label: string } {
    const [value = '100%', label = 'Metric'] = text.split('\n');
    return { value, label };
  }

  allowDrop(event: DragEvent): void {
    event.preventDefault();

    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
  }

  dropOnCanvas(event: DragEvent): void {
    event.preventDefault();
    const kind = event.dataTransfer?.getData('application/report-element') as ElementKind;

    if (!kind) {
      return;
    }

    const position = this.getCanvasPoint(event.clientX, event.clientY);
    this.state.addElement(kind, position.x, position.y);
  }

  startMove(event: PointerEvent, element: ReportElement): void {
    if ((event.target as HTMLElement).classList.contains('resize-handle')) {
      return;
    }

    event.stopPropagation();
    this.state.setSelected(element.id);
    this.activeDrag = {
      mode: 'move',
      id: element.id,
      startX: event.clientX,
      startY: event.clientY,
      originalX: element.x,
      originalY: element.y,
      originalWidth: element.width,
      originalHeight: element.height,
    };
  }

  startResize(event: PointerEvent, element: ReportElement, handle: ResizeHandle): void {
    event.stopPropagation();
    this.state.setSelected(element.id);
    this.activeDrag = {
      mode: 'resize',
      id: element.id,
      startX: event.clientX,
      startY: event.clientY,
      originalX: element.x,
      originalY: element.y,
      originalWidth: element.width,
      originalHeight: element.height,
      handle,
    };
  }

  onWheel(event: WheelEvent): void {
    // Browser touchpad pinch gestures arrive as ctrl/meta wheel events.
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }

    event.preventDefault();
    this.state.zoomBy(event.deltaY > 0 ? -4 : 4);
  }

  @HostListener('window:pointermove', ['$event'])
  onPointerMove(event: PointerEvent): void {
    if (!this.activeDrag) {
      return;
    }

    const element = this.state.report().elements.find((item) => item.id === this.activeDrag?.id);

    if (!element) {
      return;
    }

    const scale = this.canvasScale();
    // Pointer movement arrives in viewport pixels; divide by canvas scale so dragging
    // behaves the same at every zoom level.
    const deltaX = (event.clientX - this.activeDrag.startX) / scale;
    const deltaY = (event.clientY - this.activeDrag.startY) / scale;

    if (this.activeDrag.mode === 'move') {
      const candidate = this.applyGrid({
        id: element.id,
        x: this.activeDrag.originalX + deltaX,
        y: this.activeDrag.originalY + deltaY,
        width: element.width,
        height: element.height,
      });
      const snapped = this.snapRect(candidate);

      this.state.moveElement(element.id, snapped.rect.x, snapped.rect.y, false);
      this.renderDragOverlay(snapped.rect, snapped.guides);
      return;
    }

    const nextWidth = this.applyGridValue(
      this.activeDrag.handle === 'east' || this.activeDrag.handle === 'south-east'
        ? this.activeDrag.originalWidth + deltaX
        : element.width,
    );
    const nextHeight = this.applyGridValue(
      this.activeDrag.handle === 'south' || this.activeDrag.handle === 'south-east'
        ? this.activeDrag.originalHeight + deltaY
        : element.height,
    );
    const candidate = {
      id: element.id,
      x: element.x,
      y: element.y,
      width: nextWidth,
      height: nextHeight,
    };
    const snapped = this.snapRect(candidate);

    this.state.resizeElement(element.id, snapped.rect.width, snapped.rect.height, false);
    this.renderDragOverlay(snapped.rect, snapped.guides);
  }

  @HostListener('window:pointerup')
  stopDrag(): void {
    this.activeDrag = null;
    this.snapGuides.set([]);
    this.measurementGuides.set([]);
    this.dragBadge.set(null);
  }

  private getCanvasPoint(clientX: number, clientY: number): { x: number; y: number } {
    const canvas = this.pageCanvas?.nativeElement.getBoundingClientRect();

    if (!canvas) {
      return { x: 96, y: 96 };
    }

    const scale = canvas.width / this.state.report().page.width;

    return {
      x: (clientX - canvas.left) / scale,
      y: (clientY - canvas.top) / scale,
    };
  }

  private canvasScale(): number {
    const canvas = this.pageCanvas?.nativeElement.getBoundingClientRect();
    return canvas ? canvas.width / this.state.report().page.width : 1;
  }

  private snapRect(rect: CanvasRect): { rect: CanvasRect; guides: SnapGuide[] } {
    const document = this.state.report();
    const targets = this.snapTargets(rect.id);
    const guides: SnapGuide[] = [];
    let bestX: { delta: number; position: number; start: number; end: number; source: 'page' | 'element' } | null =
      null;
    let bestY: { delta: number; position: number; start: number; end: number; source: 'page' | 'element' } | null =
      null;

    for (const target of targets.vertical) {
      const candidates = [
        { edge: rect.x, delta: target.position - rect.x },
        { edge: rect.x + rect.width / 2, delta: target.position - (rect.x + rect.width / 2) },
        { edge: rect.x + rect.width, delta: target.position - (rect.x + rect.width) },
      ];

      for (const candidate of candidates) {
        if (Math.abs(candidate.delta) <= this.snapThreshold && this.isBetter(candidate.delta, bestX)) {
          bestX = { ...target, delta: candidate.delta };
        }
      }
    }

    for (const target of targets.horizontal) {
      const candidates = [
        { edge: rect.y, delta: target.position - rect.y },
        { edge: rect.y + rect.height / 2, delta: target.position - (rect.y + rect.height / 2) },
        { edge: rect.y + rect.height, delta: target.position - (rect.y + rect.height) },
      ];

      for (const candidate of candidates) {
        if (Math.abs(candidate.delta) <= this.snapThreshold && this.isBetter(candidate.delta, bestY)) {
          bestY = { ...target, delta: candidate.delta };
        }
      }
    }

    const snapped = {
      ...rect,
      x: Math.max(0, Math.min(document.page.width - rect.width, rect.x + (bestX?.delta ?? 0))),
      y: Math.max(0, Math.min(document.page.height - rect.height, rect.y + (bestY?.delta ?? 0))),
    };

    if (bestX) {
      guides.push({
        id: `v-${bestX.position}`,
        orientation: 'vertical',
        position: bestX.position,
        start: bestX.start,
        end: bestX.end,
        source: bestX.source,
      });
    }

    if (bestY) {
      guides.push({
        id: `h-${bestY.position}`,
        orientation: 'horizontal',
        position: bestY.position,
        start: bestY.start,
        end: bestY.end,
        source: bestY.source,
      });
    }

    return { rect: snapped, guides };
  }

  private snapTargets(activeId: string): {
    vertical: Array<{ position: number; start: number; end: number; source: 'page' | 'element' }>;
    horizontal: Array<{ position: number; start: number; end: number; source: 'page' | 'element' }>;
  } {
    const document = this.state.report();
    const page = document.page;
    const vertical: Array<{
      position: number;
      start: number;
      end: number;
      source: 'page' | 'element';
    }> = [
      { position: page.margin, start: 0, end: page.height, source: 'page' as const },
      { position: page.width / 2, start: 0, end: page.height, source: 'page' as const },
      { position: page.width - page.margin, start: 0, end: page.height, source: 'page' as const },
    ];
    const horizontal: Array<{
      position: number;
      start: number;
      end: number;
      source: 'page' | 'element';
    }> = [
      { position: page.margin, start: 0, end: page.width, source: 'page' as const },
      { position: page.height / 2, start: 0, end: page.width, source: 'page' as const },
      { position: page.height - page.margin, start: 0, end: page.width, source: 'page' as const },
    ];

    for (const element of document.elements.filter((item) => item.id !== activeId)) {
      vertical.push(
        { position: element.x, start: element.y, end: element.y + element.height, source: 'element' },
        {
          position: element.x + element.width / 2,
          start: element.y,
          end: element.y + element.height,
          source: 'element',
        },
        {
          position: element.x + element.width,
          start: element.y,
          end: element.y + element.height,
          source: 'element',
        },
      );
      horizontal.push(
        { position: element.y, start: element.x, end: element.x + element.width, source: 'element' },
        {
          position: element.y + element.height / 2,
          start: element.x,
          end: element.x + element.width,
          source: 'element',
        },
        {
          position: element.y + element.height,
          start: element.x,
          end: element.x + element.width,
          source: 'element',
        },
      );
    }

    return { vertical, horizontal };
  }

  private renderDragOverlay(rect: CanvasRect, guides: SnapGuide[]): void {
    this.snapGuides.set(guides);
    this.measurementGuides.set(this.measureGaps(rect));
    this.dragBadge.set({
      x: rect.x + rect.width + 10,
      y: rect.y + rect.height + 10,
      text: `${Math.round(rect.x)}, ${Math.round(rect.y)} · ${Math.round(rect.width)} × ${Math.round(
        rect.height,
      )}`,
    });
  }

  private measureGaps(rect: CanvasRect): MeasurementGuide[] {
    const elements = this.state.report().elements.filter((element) => element.id !== rect.id);
    const guides: MeasurementGuide[] = [];
    const verticalOverlap = (element: ReportElement) =>
      element.y < rect.y + rect.height && element.y + element.height > rect.y;
    const horizontalOverlap = (element: ReportElement) =>
      element.x < rect.x + rect.width && element.x + element.width > rect.x;
    const left = elements
      .filter((element) => verticalOverlap(element) && element.x + element.width <= rect.x)
      .sort((a, b) => b.x + b.width - (a.x + a.width))[0];
    const right = elements
      .filter((element) => verticalOverlap(element) && element.x >= rect.x + rect.width)
      .sort((a, b) => a.x - b.x)[0];
    const top = elements
      .filter((element) => horizontalOverlap(element) && element.y + element.height <= rect.y)
      .sort((a, b) => b.y + b.height - (a.y + a.height))[0];
    const bottom = elements
      .filter((element) => horizontalOverlap(element) && element.y >= rect.y + rect.height)
      .sort((a, b) => a.y - b.y)[0];

    if (left) {
      guides.push(this.horizontalMeasure('left', left.x + left.width, rect.x, rect.y + rect.height / 2));
    }

    if (right) {
      guides.push(
        this.horizontalMeasure('right', rect.x + rect.width, right.x, rect.y + rect.height / 2),
      );
    }

    if (top) {
      guides.push(this.verticalMeasure('top', top.y + top.height, rect.y, rect.x + rect.width / 2));
    }

    if (bottom) {
      guides.push(
        this.verticalMeasure('bottom', rect.y + rect.height, bottom.y, rect.x + rect.width / 2),
      );
    }

    return guides;
  }

  private horizontalMeasure(id: string, start: number, end: number, crossAxis: number): MeasurementGuide {
    return {
      id,
      orientation: 'horizontal',
      start,
      end,
      crossAxis,
      label: `${Math.round(Math.abs(end - start))}`,
    };
  }

  private verticalMeasure(id: string, start: number, end: number, crossAxis: number): MeasurementGuide {
    return {
      id,
      orientation: 'vertical',
      start,
      end,
      crossAxis,
      label: `${Math.round(Math.abs(end - start))}`,
    };
  }

  private isBetter(delta: number, current: { delta: number } | null): boolean {
    return !current || Math.abs(delta) < Math.abs(current.delta);
  }

  private applyGrid(rect: CanvasRect): CanvasRect {
    return {
      ...rect,
      x: this.applyGridValue(rect.x),
      y: this.applyGridValue(rect.y),
      width: this.applyGridValue(rect.width),
      height: this.applyGridValue(rect.height),
    };
  }

  private applyGridValue(value: number): number {
    return this.state.showGrid() ? Math.round(value / 8) * 8 : value;
  }
}
