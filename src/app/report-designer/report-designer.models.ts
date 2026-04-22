export type ElementKind = 'heading' | 'text' | 'metric' | 'table' | 'chart' | 'divider' | 'image';
export type TextAlign = 'left' | 'center' | 'right';
export type DragMode = 'move' | 'resize';
export type ResizeHandle = 'east' | 'south' | 'south-east';
export type TableOption = 'showHeader' | 'zebraRows' | 'compact';
export type ThemeMode = 'light' | 'dark';
export type PagePreset = 'A4' | 'Letter' | 'Custom';
export type InspectorTab = 'element' | 'page' | 'data';

export interface PaletteItem {
  kind: ElementKind;
  icon: string;
  label: string;
  description: string;
}

export interface ReportPage {
  width: number;
  height: number;
  margin: number;
  preset: PagePreset;
  background: string;
  bleed: number;
}

export interface TableData {
  columns: string[];
  rows: string[][];
  showHeader: boolean;
  zebraRows: boolean;
  compact: boolean;
  headerBackground: string;
}

export interface ReportElement {
  id: string;
  kind: ElementKind;
  title: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  color: string;
  background: string;
  align: TextAlign;
  bold: boolean;
  border: boolean;
  radius: number;
  table?: TableData;
}

export interface ReportDocument {
  version: number;
  title: string;
  subtitle: string;
  page: ReportPage;
  elements: ReportElement[];
  updatedAt: string;
}

export interface ActiveDrag {
  mode: DragMode;
  id: string;
  startX: number;
  startY: number;
  originalX: number;
  originalY: number;
  originalWidth: number;
  originalHeight: number;
  handle?: ResizeHandle;
}

export interface SnapGuide {
  id: string;
  orientation: 'vertical' | 'horizontal';
  position: number;
  start: number;
  end: number;
  source: 'page' | 'element';
}

export interface MeasurementGuide {
  id: string;
  orientation: 'horizontal' | 'vertical';
  start: number;
  end: number;
  crossAxis: number;
  label: string;
}
