// Minimal delimited-text parsing/serialization. Handles quoted fields,
// embedded delimiters and newlines. Auto-detects tab vs comma vs semicolon
// so pasting straight from Google Sheets (TSV) and Retool CSVs both work.

export function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'));
  if (firstLine.includes('\t')) return '\t';
  const commas = (firstLine.match(/,/g) || []).length;
  const semis = (firstLine.match(/;/g) || []).length;
  return semis > commas ? ';' : ',';
}

export function parseDelimited(text: string, delimiter?: string): string[][] {
  const d = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const src = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  while (i < src.length) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field === '') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === d) {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += c;
    i++;
  }
  row.push(field);
  rows.push(row);

  // drop fully empty trailing rows
  while (rows.length && rows[rows.length - 1].every((c) => c.trim() === '')) rows.pop();
  return rows;
}

function escapeField(value: string, delimiter: string): string {
  if (value.includes('"') || value.includes(delimiter) || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function serializeDelimited(rows: string[][], delimiter: string): string {
  return rows.map((r) => r.map((c) => escapeField(c ?? '', delimiter)).join(delimiter)).join('\n');
}
