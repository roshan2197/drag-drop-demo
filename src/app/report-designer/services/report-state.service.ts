import { computed, Injectable, signal } from '@angular/core';

import seedReport from '../report-template.json';
import {
  ElementKind,
  InspectorTab,
  PagePreset,
  PaletteItem,
  ReportDocument,
  ReportElement,
  TableData,
  TableOption,
  ThemeMode,
} from '../report-designer.models';

const STORAGE_KEY = 'report-designer.document.v1';
const THEME_STORAGE_KEY = 'report-designer.theme.v1';
const MIN_ELEMENT_WIDTH = 72;
const MIN_ELEMENT_HEIGHT = 28;
const GRID_SIZE = 8;

@Injectable({ providedIn: 'root' })
export class ReportStateService {
  // The palette is stable UI metadata. The actual report content lives in `report`.
  readonly palette: PaletteItem[] = [
    { kind: 'heading', icon: 'T', label: 'Heading', description: 'Section title' },
    { kind: 'text', icon: 'P', label: 'Text', description: 'Paragraph copy' },
    { kind: 'metric', icon: '#', label: 'Metric', description: 'KPI number' },
    { kind: 'table', icon: '▦', label: 'Table', description: 'Editable data grid' },
    { kind: 'chart', icon: '▥', label: 'Chart', description: 'Visual summary' },
    { kind: 'divider', icon: '─', label: 'Divider', description: 'Section rule' },
    { kind: 'image', icon: '◧', label: 'Image', description: 'Media block' },
  ];

  readonly report = signal<ReportDocument>(this.loadInitialReport());
  readonly selectedId = signal(this.report().elements[1]?.id ?? '');
  readonly selectedIds = signal<string[]>([this.selectedId() || '']);
  readonly showGrid = signal(true);
  readonly zoom = signal(86);
  readonly theme = signal<ThemeMode>(this.loadTheme());

  readonly activeInspectorTab = signal<InspectorTab>('element');
  readonly selectedElement = computed(() =>
    this.report().elements.find((element) => element.id === this.selectedId()),
  );
  readonly selectedElements = computed(() =>
    this.report().elements.filter((element) => this.selectedIds().includes(element.id)),
  );
  readonly canUndo = signal(false);
  readonly canRedo = signal(false);
  readonly historyCount = signal(0);
  readonly futureCount = signal(0);
  readonly clipboard = signal<ReportElement[] | null>(null);
  readonly syncStatus = signal<'saved' | 'saving'>('saved');
  readonly lastSyncedAt = signal<string>(new Date().toLocaleTimeString());

  private readonly history: ReportDocument[] = [];
  private readonly future: ReportDocument[] = [];

  // Public mutations are the single write path for the designer.
  // Replacing `sync` with an HTTP save later will keep the components unchanged.
  updateMeta(patch: Partial<Pick<ReportDocument, 'title' | 'subtitle'>>): void {
    this.sync({ ...this.report(), ...patch });
  }

  updatePage(patch: Partial<ReportDocument['page']>): void {
    const document = this.cloneReport();
    const page = { ...document.page, ...patch };

    if (patch.preset && patch.preset !== 'Custom') {
      Object.assign(page, this.presetSize(patch.preset));
    }

    page.width = Math.max(320, Math.round(Number(page.width) || 794));
    page.height = Math.max(420, Math.round(Number(page.height) || 1123));
    page.margin = Math.max(0, Math.min(180, Math.round(Number(page.margin) || 0)));
    page.bleed = Math.max(0, Math.min(48, Math.round(Number(page.bleed) || 0)));

    document.page = page;
    document.elements = document.elements.map((element) => {
      const nextElement = this.clone(element);
      this.normalizeElementBounds(nextElement, document);
      return nextElement;
    });
    this.sync(document);
  }

  setInspectorTab(tab: InspectorTab): void {
    this.activeInspectorTab.set(tab);
  }

  setSelected(id: string, activateInspector = false, additive = false): void {
    if (additive) {
      const currentSelection = this.selectedIds().filter(Boolean);
      const isSelected = currentSelection.includes(id);

      if (isSelected) {
        const nextSelection = currentSelection.filter((selected) => selected !== id);
        this.selectedIds.set(nextSelection);
        this.selectedId.set(nextSelection[0] ?? '');
      } else {
        this.selectedIds.set([...currentSelection, id]);
        this.selectedId.set(id);
      }
    } else {
      this.selectedIds.set([id]);
      this.selectedId.set(id);
    }

    if (activateInspector) {
      this.setInspectorTab('element');
    }
  }

  clearSelection(): void {
    this.selectedIds.set([]);
    this.selectedId.set('');
    this.setInspectorTab('page');
  }

  setTheme(theme: ThemeMode): void {
    this.theme.set(theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }

  toggleTheme(): void {
    this.setTheme(this.theme() === 'light' ? 'dark' : 'light');
  }

  setZoom(value: number): void {
    this.zoom.set(Math.max(25, Math.min(500, Math.round(value))));
  }

  zoomBy(delta: number): void {
    this.setZoom(this.zoom() + delta);
  }

  setShowGrid(value: boolean): void {
    this.showGrid.set(value);
  }

  addElement(kind: ElementKind, x = 96, y = 96): void {
    const document = this.cloneReport();
    const element = this.createElement(kind, this.snap(x), this.snap(y), document);
    document.elements.push(element);
    this.selectedIds.set([element.id]);
    this.selectedId.set(element.id);
    this.sync(document);
  }

  updateElement(id: string, patch: Partial<ReportElement>): void {
    this.mutateElement(id, (element, document) => {
      Object.assign(element, patch);
      this.normalizeElementBounds(element, document);
    });
  }

  updateElementNumber(
    id: string,
    key: 'x' | 'y' | 'width' | 'height' | 'fontSize' | 'radius' | 'borderWidth',
    value: number,
  ): void {
    this.mutateElement(id, (element, document) => {
      element[key] = Number(value) || 0;
      this.normalizeElementBounds(element, document);
    });
  }

  moveElement(
    id: string,
    x: number,
    y: number,
    snapToGrid = true,
    record = true,
    persist = true,
  ): void {
    this.mutateElement(
      id,
      (element, document) => {
        element.x = this.constrainX(snapToGrid ? this.snap(x) : Math.round(x), element.width, document);
        element.y = this.constrainY(snapToGrid ? this.snap(y) : Math.round(y), element.height, document);
      },
      record,
      persist,
    );
  }

  resizeElement(
    id: string,
    width: number,
    height: number,
    snapToGrid = true,
    record = true,
    persist = true,
  ): void {
    this.mutateElement(
      id,
      (element, document) => {
        element.width = this.constrainWidth(
          snapToGrid ? this.snap(width) : Math.round(width),
          element.x,
          document,
        );
        element.height = this.constrainHeight(
          snapToGrid ? this.snap(height) : Math.round(height),
          element.y,
          document,
        );
      },
      record,
      persist,
    );
  }

  moveSelectedBy(deltaX: number, deltaY: number): void {
    const selectedIds = this.selectedIds().filter(Boolean);

    if (selectedIds.length === 0) {
      return;
    }

    const document = this.cloneReport();
    const elements = document.elements.filter((element) => selectedIds.includes(element.id));

    elements.forEach((element) => {
      element.x = this.constrainX(this.snap(element.x + deltaX), element.width, document);
      element.y = this.constrainY(this.snap(element.y + deltaY), element.height, document);
    });

    this.sync(document);
  }

  copySelected(): void {
    const selected = this.selectedElements();

    if (selected.length === 0) {
      return;
    }

    this.clipboard.set(selected.map((element) => this.clone(element)));
  }

  cutSelected(): void {
    this.copySelected();
    this.deleteSelected();
  }

  pasteClipboard(): void {
    const clipboard = this.clipboard();

    if (!clipboard || clipboard.length === 0) {
      return;
    }

    const document = this.cloneReport();
    const originX = Math.min(...clipboard.map((element) => element.x));
    const originY = Math.min(...clipboard.map((element) => element.y));
    const addedIds: string[] = [];

    clipboard.forEach((element) => {
      const cloneElement = this.clone(element);
      cloneElement.id = this.createId();
      cloneElement.x = this.constrainX(cloneElement.x - originX + 24, cloneElement.width, document);
      cloneElement.y = this.constrainY(cloneElement.y - originY + 24, cloneElement.height, document);
      document.elements.push(cloneElement);
      addedIds.push(cloneElement.id);
    });

    this.selectedIds.set(addedIds);
    this.selectedId.set(addedIds[0]);
    this.sync(document);
  }

  commitDrag(): void {
    this.sync(this.cloneReport());
  }

  undo(): void {
    if (this.history.length === 0) {
      return;
    }

    const previous = this.history.pop();
    if (!previous) {
      return;
    }

    this.future.push(this.cloneReport());
    this.futureCount.set(this.future.length);
    this.sync(previous, false);
    this.canUndo.set(this.history.length > 0);
  }

  redo(): void {
    if (this.future.length === 0) {
      return;
    }

    const next = this.future.pop();
    if (!next) {
      return;
    }

    this.history.push(this.cloneReport());
    this.historyCount.set(this.history.length);
    this.sync(next, false);
    this.canRedo.set(this.future.length > 0);
  }

  private recordHistory(document: ReportDocument): void {
    this.history.push(this.clone(this.report()));
    if (this.history.length > 50) {
      this.history.shift();
    }
    this.historyCount.set(this.history.length);
    this.future.length = 0;
    this.futureCount.set(0);
    this.canUndo.set(this.history.length > 0);
    this.canRedo.set(false);
  }

  private clearHistory(): void {
    this.history.length = 0;
    this.future.length = 0;
    this.historyCount.set(0);
    this.futureCount.set(0);
    this.canUndo.set(false);
    this.canRedo.set(false);
  }

  duplicateSelected(): void {
    const selectedIds = this.selectedIds().filter(Boolean);

    if (selectedIds.length === 0) {
      return;
    }

    const document = this.cloneReport();
    const addedIds: string[] = [];

    selectedIds.forEach((id) => {
      const selected = document.elements.find((element) => element.id === id);
      if (!selected) {
        return;
      }

      const duplicate: ReportElement = {
        ...this.clone(selected),
        id: this.createId(),
        title: `${selected.title} copy`,
        x: this.constrainX(selected.x + 24, selected.width, document),
        y: this.constrainY(selected.y + 24, selected.height, document),
      };

      document.elements.push(duplicate);
      addedIds.push(duplicate.id);
    });

    if (addedIds.length > 0) {
      this.selectedIds.set(addedIds);
      this.selectedId.set(addedIds[0]);
      this.sync(document);
    }
  }

  deleteSelected(): void {
    const selectedIds = this.selectedIds().filter(Boolean);

    if (selectedIds.length === 0) {
      return;
    }

    const document = this.cloneReport();
    document.elements = document.elements.filter((element) => !selectedIds.includes(element.id));
    const nextId = document.elements[0]?.id ?? '';
    this.selectedIds.set(nextId ? [nextId] : []);
    this.selectedId.set(nextId);
    this.sync(document);
  }

  bringForward(): void {
    this.reorderSelected(1);
  }

  sendBackward(): void {
    this.reorderSelected(-1);
  }

  // Table edits keep both the structured table model and CSV-like text mirror in sync.
  // The text mirror is useful for simple import/export and backward-compatible data.
  updateTableColumn(elementId: string, columnIndex: number, value: string): void {
    this.mutateTable(elementId, (table) => {
      table.columns[columnIndex] = value;
    });
  }

  updateTableCell(elementId: string, rowIndex: number, columnIndex: number, value: string): void {
    this.mutateTable(elementId, (table) => {
      this.ensureRowWidth(table, rowIndex);
      table.rows[rowIndex][columnIndex] = value;
    });
  }

  addTableRow(elementId: string): void {
    this.mutateTable(elementId, (table) => {
      table.rows.push(table.columns.map(() => ''));
    });
  }

  removeTableRow(elementId: string, rowIndex: number): void {
    this.mutateTable(elementId, (table) => {
      table.rows.splice(rowIndex, 1);
    });
  }

  addTableColumn(elementId: string): void {
    this.mutateTable(elementId, (table) => {
      table.columns.push(`Column ${table.columns.length + 1}`);
      table.rows = table.rows.map((row) => [...row, '']);
    });
  }

  removeTableColumn(elementId: string, columnIndex: number): void {
    this.mutateTable(elementId, (table) => {
      if (table.columns.length === 1) {
        return;
      }

      table.columns.splice(columnIndex, 1);
      table.rows = table.rows.map((row) => row.filter((_, index) => index !== columnIndex));
    });
  }

  updateTableHeaderBackground(elementId: string, color: string): void {
    this.mutateTable(elementId, (table) => {
      table.headerBackground = color;
    });
  }

  toggleTableOption(elementId: string, option: TableOption): void {
    this.mutateTable(elementId, (table) => {
      table[option] = !table[option];
    });
  }

  // JSON import/export uses the same document shape as the seed file.
  // It gives us file-based persistence today and a clean backend contract later.
  exportJson(): void {
    const blob = new Blob([JSON.stringify(this.report(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = 'report-template.json';
    link.click();
    URL.revokeObjectURL(url);
  }

  async importJson(file: File): Promise<void> {
    const document = JSON.parse(await file.text()) as ReportDocument;
    const normalized = this.normalizeReport(document);
    const firstId = normalized.elements[0]?.id ?? '';

    this.clearHistory();
    this.selectedIds.set(firstId ? [firstId] : []);
    this.selectedId.set(firstId);
    this.sync(normalized, false);
  }

  resetToTemplate(): void {
    const document = this.normalizeReport(seedReport as ReportDocument);
    const defaultId = document.elements[1]?.id ?? document.elements[0]?.id ?? '';

    this.clearHistory();
    this.selectedIds.set(defaultId ? [defaultId] : []);
    this.selectedId.set(defaultId);
    this.sync(document, false);
  }

  private mutateElement(
    id: string,
    mutator: (element: ReportElement, document: ReportDocument) => void,
    record = true,
    persist = true,
  ): void {
    const document = this.cloneReport();
    const element = document.elements.find((item) => item.id === id);

    if (!element) {
      return;
    }

    mutator(element, document);
    this.sync(document, record, persist);
  }

  private mutateTable(elementId: string, mutator: (table: TableData) => void): void {
    this.mutateElement(elementId, (element) => {
      element.table = element.table ?? this.tableFromText(element.text);
      mutator(element.table);
      element.text = this.tableToText(element.table);
    });
  }

  private reorderSelected(direction: 1 | -1): void {
    const selectedId = this.selectedId();
    const document = this.cloneReport();
    const index = document.elements.findIndex((element) => element.id === selectedId);
    const nextIndex = index + direction;

    if (index < 0 || nextIndex < 0 || nextIndex >= document.elements.length) {
      return;
    }

    [document.elements[index], document.elements[nextIndex]] = [
      document.elements[nextIndex],
      document.elements[index],
    ];
    this.sync(document);
  }

  // `sync` is intentionally tiny: normalize, publish signal, persist snapshot.
  // Backend persistence can be added here without changing canvas/inspector code.
  private sync(document: ReportDocument, record = true, persist = true): void {
    const nextDocument = this.normalizeReport({
      ...document,
      updatedAt: new Date().toISOString(),
    });

    if (record) {
      this.recordHistory(nextDocument);
    }

    this.report.set(nextDocument);
    if (persist) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextDocument));
    }
  }

  private loadInitialReport(): ReportDocument {
    const stored = localStorage.getItem(STORAGE_KEY);

    if (stored) {
      try {
        return this.normalizeReport(JSON.parse(stored) as ReportDocument);
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }

    return this.normalizeReport(seedReport as ReportDocument);
  }

  private normalizeReport(document: ReportDocument): ReportDocument {
    return {
      version: document.version ?? 1,
      title: document.title ?? 'Untitled report',
      subtitle: document.subtitle ?? '',
      page: {
        width: document.page?.width ?? 794,
        height: document.page?.height ?? 1123,
        margin: document.page?.margin ?? 64,
        preset: document.page?.preset ?? 'A4',
        background: document.page?.background ?? '#ffffff',
        bleed: document.page?.bleed ?? 0,
      },
      updatedAt: document.updatedAt ?? new Date().toISOString(),
      elements: (document.elements ?? []).map((element) => this.normalizeElement(element)),
    };
  }

  private normalizeElement(element: ReportElement): ReportElement {
    const nextElement: ReportElement = {
      id: element.id ?? this.createId(),
      kind: element.kind ?? 'text',
      title: element.title ?? 'Element',
      text: element.text ?? '',
      x: element.x ?? 96,
      y: element.y ?? 96,
      width: element.width ?? 240,
      height: element.height ?? 80,
      fontSize: element.fontSize ?? 14,
      color: element.color ?? '#172033',
      background: element.background ?? '#ffffff',
      align: element.align ?? 'left',
      bold: element.bold ?? false,
      border: element.border ?? false,
      borderWidth: element.borderWidth ?? 1,
      borderColor: element.borderColor ?? '#d8e0ee',
      radius: element.radius ?? 8,
    };

    if (nextElement.kind === 'table') {
      nextElement.table = element.table ?? this.tableFromText(nextElement.text);
      nextElement.text = this.tableToText(nextElement.table);
    }

    return nextElement;
  }

  private createElement(
    kind: ElementKind,
    x: number,
    y: number,
    document: ReportDocument,
  ): ReportElement {
    const base = {
      id: this.createId(),
      kind,
      x,
      y,
      align: 'left' as const,
      border: false,
      borderWidth: 1,
      borderColor: '#d8e0ee',
      bold: false,
      radius: 8,
    };

    const templates: Record<ElementKind, Omit<ReportElement, keyof typeof base>> = {
      heading: {
        title: 'Heading',
        text: 'New report heading',
        width: 340,
        height: 62,
        fontSize: 28,
        color: '#172033',
        background: '#ffffff',
      },
      text: {
        title: 'Text block',
        text: 'Add supporting narrative, notes, or analysis here.',
        width: 320,
        height: 90,
        fontSize: 14,
        color: '#475569',
        background: '#ffffff',
      },
      metric: {
        title: 'Metric card',
        text: '84%\nCompletion',
        width: 190,
        height: 94,
        fontSize: 30,
        color: '#0f172a',
        background: '#ecfeff',
      },
      table: {
        title: 'Data table',
        text: 'Name,Value,Status\nPipeline,$1.2M,Healthy\nForecast,$940K,Review',
        width: 420,
        height: 180,
        fontSize: 13,
        color: '#253044',
        background: '#ffffff',
        table: {
          columns: ['Name', 'Value', 'Status'],
          rows: [
            ['Pipeline', '$1.2M', 'Healthy'],
            ['Forecast', '$940K', 'Review'],
          ],
          showHeader: true,
          zebraRows: true,
          compact: false,
          headerBackground: '#f7fafc',
        },
      },
      chart: {
        title: 'Bar chart',
        text: 'Chart title',
        width: 420,
        height: 190,
        fontSize: 16,
        color: '#172033',
        background: '#ffffff',
      },
      divider: {
        title: 'Divider',
        text: '',
        width: 300,
        height: 2,
        fontSize: 1,
        color: '#cbd5e1',
        background: '#cbd5e1',
      },
      image: {
        title: 'Image',
        text: 'Image placeholder',
        width: 260,
        height: 160,
        fontSize: 14,
        color: '#64748b',
        background: '#f8fafc',
      },
    };

    const element: ReportElement = { ...base, ...templates[kind] };
    element.x = this.constrainX(element.x, element.width, document);
    element.y = this.constrainY(element.y, element.height, document);

    if (kind === 'heading') {
      element.bold = true;
    }

    if (kind === 'metric' || kind === 'table' || kind === 'chart' || kind === 'image') {
      element.border = true;
    }

    if (kind === 'metric') {
      element.align = 'center';
      element.bold = true;
    }

    return element;
  }

  private tableFromText(text: string): TableData {
    const rows = text
      .split('\n')
      .map((row) => row.split(',').map((cell) => cell.trim()))
      .filter((row) => row.some(Boolean));
    const columns = rows[0]?.length ? rows[0] : ['Column 1', 'Column 2'];
    const body = rows.slice(1);

    return {
      columns,
      rows: body.length ? body : [columns.map(() => '')],
      showHeader: true,
      zebraRows: true,
      compact: false,
      headerBackground: '#f7fafc',
    };
  }

  private tableToText(table: TableData): string {
    return [table.columns, ...table.rows].map((row) => row.join(',')).join('\n');
  }

  private ensureRowWidth(table: TableData, rowIndex: number): void {
    const row = table.rows[rowIndex] ?? table.columns.map(() => '');
    while (row.length < table.columns.length) {
      row.push('');
    }
    table.rows[rowIndex] = row;
  }

  private normalizeElementBounds(element: ReportElement, document: ReportDocument): void {
    element.width = this.constrainWidth(this.snap(element.width), element.x, document);
    element.height = this.constrainHeight(this.snap(element.height), element.y, document);
    element.x = this.constrainX(this.snap(element.x), element.width, document);
    element.y = this.constrainY(this.snap(element.y), element.height, document);
    element.fontSize = Math.max(8, Math.min(72, element.fontSize));
    element.radius = Math.max(0, Math.min(32, element.radius));
  }

  private cloneReport(): ReportDocument {
    return this.clone(this.report());
  }

  private clone<T>(value: T): T {
    return structuredClone(value);
  }

  private createId(): string {
    return `el-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  private snap(value: number): number {
    return Math.round(value / GRID_SIZE) * GRID_SIZE;
  }

  private constrainX(value: number, width: number, document: ReportDocument): number {
    return Math.max(0, Math.min(document.page.width - width, value));
  }

  private constrainY(value: number, height: number, document: ReportDocument): number {
    return Math.max(0, Math.min(document.page.height - height, value));
  }

  private constrainWidth(value: number, x: number, document: ReportDocument): number {
    return Math.max(MIN_ELEMENT_WIDTH, Math.min(document.page.width - x, value));
  }

  private constrainHeight(value: number, y: number, document: ReportDocument): number {
    return Math.max(MIN_ELEMENT_HEIGHT, Math.min(document.page.height - y, value));
  }

  private presetSize(preset: PagePreset): Pick<ReportDocument['page'], 'width' | 'height'> {
    if (preset === 'Custom') {
      return { width: this.report().page.width, height: this.report().page.height };
    }

    const presets: Record<Exclude<PagePreset, 'Custom'>, { width: number; height: number }> = {
      A4: { width: 794, height: 1123 },
      Letter: { width: 816, height: 1056 },
    };

    return presets[preset];
  }

  private loadTheme(): ThemeMode {
    return localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  }
}
