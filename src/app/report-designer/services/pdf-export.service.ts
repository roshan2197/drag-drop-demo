import { Injectable } from '@angular/core';
import type {
  Content,
  ContentTable,
  TDocumentDefinitions,
  TableCell,
} from 'pdfmake/interfaces';

import { ReportDocument, ReportElement, TableData } from '../report-designer.models';

@Injectable({ providedIn: 'root' })
export class PdfExportService {
  async export(document: ReportDocument): Promise<void> {
    // pdfmake is sizeable, so keep it out of the first app bundle.
    const [pdfMake, pdfFonts] = await Promise.all([
      import('pdfmake/build/pdfmake'),
      import('pdfmake/build/vfs_fonts'),
    ]);
    const fontVfs =
      (pdfFonts as unknown as { vfs?: Record<string, string> }).vfs ??
      (pdfFonts as unknown as Record<string, string>);

    pdfMake
      .createPdf(this.createDefinition(document), undefined, undefined, fontVfs)
      .download(`${this.slug(document.title)}.pdf`);
  }

  private createDefinition(document: ReportDocument): TDocumentDefinitions {
    // The PDF definition mirrors the absolute-positioned canvas model.
    // That keeps export predictable while the visual designer remains free-form.
    return {
      pageSize: {
        width: document.page.width,
        height: document.page.height,
      },
      pageMargins: [0, 0, 0, 0],
      defaultStyle: {
        font: 'Roboto',
        color: '#0f172a',
      },
      content: [
        {
          canvas: [
            {
              type: 'rect',
              x: 0,
              y: 0,
              w: document.page.width,
              h: document.page.height,
              color: document.page.background,
            },
          ],
          absolutePosition: { x: 0, y: 0 },
        },
        ...document.elements.map((element) => this.elementToPdf(element)),
      ],
    };
  }

  private elementToPdf(element: ReportElement): Content {
    const base = {
      absolutePosition: { x: element.x, y: element.y },
      margin: [0, 0, 0, 0] as [number, number, number, number],
    };

    if (element.kind === 'divider') {
      return {
        ...base,
        canvas: [
          {
            type: 'rect',
            x: 0,
            y: 0,
            w: element.width,
            h: Math.max(1, element.height),
            color: element.background,
          },
        ],
      };
    }

    if (element.kind === 'table') {
      return this.tableElementToPdf(element, base);
    }

    if (element.kind === 'chart') {
      return this.chartElementToPdf(element, base);
    }

    if (element.kind === 'image') {
      return this.imagePlaceholderToPdf(element, base);
    }

    const text = element.kind === 'metric' ? this.metricText(element.text) : element.text;

    return {
      ...base,
      stack: [
        this.backgroundCanvas(element),
        {
          text,
          margin: [12, 10, 12, 10],
          fontSize: element.fontSize,
          bold: element.bold,
          color: element.color,
          alignment: element.align,
        },
      ],
    };
  }

  private tableElementToPdf(
    element: ReportElement,
    base: { absolutePosition: { x: number; y: number }; margin: [number, number, number, number] },
  ): Content {
    const table = element.table ?? this.fallbackTable(element.text);
    const body: TableCell[][] = [];

    if (table.showHeader) {
      body.push(
        table.columns.map((column) => ({
          text: column,
          bold: true,
          fillColor: table.headerBackground,
          color: '#0f172a',
          alignment: 'left' as const,
        })),
      );
    }

    table.rows.forEach((row, rowIndex) => {
      body.push(
        table.columns.map((_, columnIndex) => ({
          text: row[columnIndex] ?? '',
          color: '#0f172a',
          alignment: 'left' as const,
        })),
      );
    });

    return {
      ...base,
      stack: [
        this.backgroundCanvas(element),
        {
          table: {
            headerRows: table.showHeader ? 1 : 0,
            widths: table.columns.map(() => element.width / Math.max(1, table.columns.length)),
            heights: table.compact ? 24 : 32,
            body,
          },
          layout: {
            fillColor: (rowIndex: number) =>
              rowIndex === 0 && table.showHeader
                ? table.headerBackground
                : table.zebraRows && rowIndex % 2 === 1
                ? '#f8fafc'
                : '#ffffff',
            hLineWidth: () => 0.5,
            vLineWidth: () => 0.5,
            hLineColor: () => '#cbd5e1',
            vLineColor: () => '#cbd5e1',
            paddingLeft: () => 10,
            paddingRight: () => 10,
            paddingTop: () => (table.compact ? 6 : 10),
            paddingBottom: () => (table.compact ? 6 : 10),
          },
          fontSize: element.fontSize,
          color: element.color,
          margin: [8, 12, 8, 12],
        },
      ],
    };
  }

  private chartElementToPdf(
    element: ReportElement,
    base: { absolutePosition: { x: number; y: number }; margin: [number, number, number, number] },
  ): Content {
    const barWidth = (element.width - 72) / 5;
    const values = [0.42, 0.68, 0.54, 0.82, 0.63];

    return {
      ...base,
      stack: [
        this.backgroundCanvas(element),
        {
          text: element.text,
          margin: [14, 14, 14, 0],
          bold: true,
          fontSize: element.fontSize,
          color: element.color,
        },
        {
          canvas: values.map((value, index) => ({
            type: 'rect',
            x: 14 + index * (barWidth + 10),
            y: 150 - value * 130,
            w: barWidth,
            h: value * 130,
            color: index % 2 === 0 ? '#4f46e5' : '#14b8a6',
          })),
          margin: [0, 0, 0, 0],
        },
      ],
    };
  }

  private imagePlaceholderToPdf(
    element: ReportElement,
    base: { absolutePosition: { x: number; y: number }; margin: [number, number, number, number] },
  ): Content {
    return {
      ...base,
      stack: [
        this.backgroundCanvas(element),
        {
          text: element.text,
          alignment: 'center',
          margin: [12, element.height / 2 - 10, 12, 0],
          bold: true,
          fontSize: element.fontSize,
          color: element.color,
        },
      ],
    };
  }

  private backgroundCanvas(element: ReportElement): Content {
    return {
      canvas: [
        {
          type: 'rect',
          x: 0,
          y: 0,
          w: element.width,
          h: element.height,
          r: element.radius,
          color: element.background,
          lineColor: element.border ? element.borderColor : element.background,
          lineWidth: element.border ? element.borderWidth : 0,
        },
      ],
    };
  }

  private metricText(value: string): Content[] {
    const [metric = '', label = ''] = value.split('\n');

    return [
      { text: metric, fontSize: 30, bold: true },
      { text: `\n${label}`, fontSize: 12, bold: true, color: '#64748b' },
    ];
  }

  private fallbackTable(text: string): TableData {
    const rows = text
      .split('\n')
      .map((row) => row.split(',').map((cell) => cell.trim()))
      .filter((row) => row.some(Boolean));

    return {
      columns: rows[0] ?? ['Column 1'],
      rows: rows.slice(1),
      showHeader: true,
      zebraRows: true,
      compact: false,
      headerBackground: '#f7fafc',
    };
  }

  private slug(value: string): string {
    return (
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'report'
    );
  }
}
