// Grid importer — turns a grid pasted from Google Sheets into Seat objects.
// Each cell = one seat, blank cell = aisle/gap, one pasted row = one venue row.
// Grid position is the adjacency source of truth (never label parsing).

import { parseDelimited } from './csv';
import { normalizeCategory, type Seat } from './types';

export interface GridParseOptions {
  mode: 'labels' | 'numbers' | 'refs';
  // mode 'numbers' (required) and 'refs' (optional): category for the whole pasted block
  category?: string;
  // mode 'numbers' only: row name prefix (rows become A1, A2…)
  rowPrefix?: string;
  // mode 'refs' only: cells that don't look like seat references (gate labels,
  // bare numbers) become gaps instead of seats — they usually mark walkways
  skipNonRefs?: boolean;
  // priority direction: true = first pasted row is closest to the stage (best seats)
  firstRowIsFront: boolean;
  // when appending to an existing map, place below it
  gridYOffset?: number;
  existingLabels?: Set<string>;
}

export interface GridProblem {
  level: 'error' | 'warning';
  message: string;
}

export interface GridParseResult {
  seats: Seat[];
  problems: GridProblem[];
  skipped: string[]; // refs mode: non-reference cells turned into gaps
  stats: {
    rows: number;
    seats: number;
    segments: number;
    categories: Record<string, number>;
    rowLengths: number[];
  };
}

// a seat reference is "something-number" with no spaces, e.g. T1-93 or A-13
const REF_PATTERN = /^\S+-\d+$/;

export function parseGridText(text: string): string[][] {
  return parseDelimited(text).map((row) => row.map((c) => c.trim()));
}

export function buildSeatsFromGrid(cells: string[][], opts: GridParseOptions): GridParseResult {
  const problems: GridProblem[] = [];
  const seats: Seat[] = [];
  const seenLabels = new Set<string>(opts.existingLabels ?? []);
  const dupes: string[] = [];
  const badLabels: string[] = [];
  const skipped: string[] = [];
  const yOffset = opts.gridYOffset ?? 0;
  let segments = 0;
  const rowLengths: number[] = [];
  const categories: Record<string, number> = {};

  // drop fully-blank leading/trailing grid rows but keep blank rows in the
  // middle (they are vertical walkways and preserve visual spacing)
  let firstRow = 0;
  let lastRow = cells.length - 1;
  while (firstRow <= lastRow && cells[firstRow].every((c) => !c)) firstRow++;
  while (lastRow >= firstRow && cells[lastRow].every((c) => !c)) lastRow--;

  const totalRows = lastRow - firstRow + 1;
  let seatRowIndex = 0; // counts only rows that contain seats, for naming/priority

  for (let y = firstRow; y <= lastRow; y++) {
    const row = cells[y];
    const hasSeats = row.some((c) => c);
    if (!hasSeats) continue;
    seatRowIndex++;
    const gridY = y - firstRow + yOffset;
    const priorityRow = opts.firstRowIsFront ? seatRowIndex : totalRows - seatRowIndex + 1;

    let segStart = -1;
    let rowSeatCount = 0;

    for (let x = 0; x <= row.length; x++) {
      const raw = x < row.length ? row[x] : '';
      const isDecoration = !!raw && opts.mode === 'refs' && !!opts.skipNonRefs && !REF_PATTERN.test(raw);
      if (isDecoration) skipped.push(raw);
      const cell = isDecoration ? '' : raw;
      if (cell) {
        if (segStart === -1) {
          segStart = x;
          segments++;
        }
        let label: string;
        let category: string;
        let rowName: string;

        let displayLabel: string | undefined;

        if (opts.mode === 'labels') {
          label = cell;
          const parts = cell.split('-').map((p) => p.trim());
          if (parts.length >= 3) {
            category = normalizeCategory(parts[0]);
            rowName = parts.slice(1, -1).join('-');
          } else if (parts.length === 2) {
            category = normalizeCategory(parts[0]);
            rowName = `R${seatRowIndex}`;
          } else {
            badLabels.push(cell);
            category = '';
            rowName = `R${seatRowIndex}`;
          }
        } else if (opts.mode === 'refs') {
          // cell contains a seat reference like "A-13" — category supplied
          // separately (or left blank and painted on the map afterwards)
          category = normalizeCategory(opts.category || '');
          const lastDash = cell.lastIndexOf('-');
          rowName = lastDash > 0 ? cell.slice(0, lastDash) : `R${seatRowIndex}`;
          label = category ? `${category}-${cell}` : cell;
          displayLabel = cell; // exported label is the raw cell, not the prefixed key
        } else {
          category = normalizeCategory(opts.category || '');
          rowName = `${opts.rowPrefix || 'R'}${seatRowIndex}`;
          label = `${category}-${rowName}-${cell}`;
        }

        if (seenLabels.has(label)) {
          if (opts.mode === 'refs') {
            // duplicated references are usually real seats in different sections
            // — keep both, make the internal key unique, warn the admin
            dupes.push(displayLabel ?? label);
            let n = 2;
            while (seenLabels.has(`${label}~${n}`)) n++;
            label = `${label}~${n}`;
          } else {
            dupes.push(label);
          }
        }
        seenLabels.add(label);

        seats.push({
          seat_label: label,
          ...(displayLabel !== undefined ? { display_label: displayLabel } : {}),
          category,
          priority: priorityRow,
          status: 'available',
          segment_id: `y${gridY}s${segStart}`,
          grid_x: x,
          grid_y: gridY,
          row_name: rowName,
        });
        if (category) categories[category] = (categories[category] || 0) + 1;
        rowSeatCount++;
      } else {
        segStart = -1;
      }
    }
    rowLengths.push(rowSeatCount);
  }

  if (seats.length === 0) {
    problems.push({ level: 'error', message: 'No seats found. Make sure each seat is one cell and you copied the cells (not an image).' });
  }
  if (dupes.length) {
    if (opts.mode === 'refs') {
      problems.push({
        level: 'warning',
        message: `${dupes.length} seat reference(s) appear more than once (e.g. ${[...new Set(dupes)].slice(0, 6).join(', ')}). They were kept as separate seats — fine if different sections share row names, otherwise double-check the sheet.`,
      });
    } else {
      problems.push({
        level: 'error',
        message: `Duplicate seat labels — every seat needs a unique label. Duplicates: ${dupes.slice(0, 8).join(', ')}${dupes.length > 8 ? ` and ${dupes.length - 8} more` : ''}`,
      });
    }
  }
  if (skipped.length) {
    problems.push({
      level: 'warning',
      message: `${skipped.length} cell(s) were skipped because they don't look like seat references (e.g. ${[...new Set(skipped)].slice(0, 6).join(', ')}). They became gaps. Untick "Skip cells that aren't seat references" if they are real seats.`,
    });
  }
  if (badLabels.length) {
    problems.push({
      level: 'error',
      message: `${badLabels.length} cell(s) don't look like full seat labels (expected CATEGORY-ROW-NUMBER, e.g. GOLD-A1-45). Examples: ${badLabels.slice(0, 5).join(', ')}. If your cells only contain seat numbers, choose "Cells contain seat numbers" instead.`,
    });
  }
  if (opts.mode === 'numbers' && !normalizeCategory(opts.category || '')) {
    problems.push({ level: 'error', message: 'Please enter the ticket category for this block (e.g. GOLD).' });
  }
  if (opts.mode === 'refs' && !normalizeCategory(opts.category || '') && seats.length) {
    problems.push({
      level: 'warning',
      message: 'No category set — seats will be imported without one. After importing, use "Select seats" above the map to drag a box around each area and give it a category.',
    });
  }

  // outlier rows: one row much longer than the median usually means a paste mistake
  if (rowLengths.length > 2) {
    const sorted = [...rowLengths].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const outliers = rowLengths.filter((l) => median > 0 && l > median * 3);
    if (outliers.length) {
      problems.push({ level: 'warning', message: `${outliers.length} row(s) are much longer than the others — double-check the paste.` });
    }
  }

  return {
    seats,
    problems,
    skipped,
    stats: { rows: rowLengths.length, seats: seats.length, segments, categories, rowLengths },
  };
}
