# Drag Drop Demo

A modern Angular report designer application built with Angular 21. The app includes drag-and-drop page composition, canvas zoom controls, element inspector editing, undo/redo, clipboard actions, and PDF export.

## Features

- Drag palette components onto the report canvas
- Select, move, resize, and edit page elements
- Page-level settings for size, margin, and background
- Dark mode support
- Keyboard shortcuts for undo/redo, copy/cut/paste, delete, and arrow movement
- PDF export using `pdfmake`
- Local JSON export/import and browser persistence

## Quick Start

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm start
```

Open the app at `http://localhost:4200/`.

## Available Scripts

- `npm start` - Launches the Angular development server
- `npm run build` - Builds the app for production in `dist/`
- `npm test` - Runs unit tests
- `npm run gh-pages` - Builds the app and deploys to GitHub Pages

## Project Structure

- `src/main.ts` - Application bootstrap
- `src/app/app.ts` - Root application component
- `src/app/report-designer/` - Main designer feature
  - `report-designer.component.ts` / `.html` / `.css` - Designer shell and toolbar
  - `components/palette/` - Drag palette UI
  - `components/canvas/` - Report canvas, zoom, and drag handling
  - `components/inspector/` - Property inspector and page settings
  - `services/report-state.service.ts` - Signal-based state management and undo/redo
  - `services/pdf-export.service.ts` - PDF generation helper

## Styling and UX

The app uses a custom component-based UI with responsive layout rules:

- Left palette panel for element types
- Middle canvas panel for document preview and interaction
- Right inspector panel for selected element/page properties
- Sticky top toolbar with action buttons and live sync/page metadata

## Notes

- Copy/cut/paste operates on the application clipboard and works when an element is selected
- PDF export is lazy-loaded and generates output in the browser
- The app is designed to work in both light and dark themes

## License

This project is provided as-is for demonstration and development.
