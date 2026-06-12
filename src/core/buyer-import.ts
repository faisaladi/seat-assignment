// Buyer importer — consumes the raw Retool export.
// Required columns: Transaction ID, Booking Code, Ticket Code, Event Name, Ticket Name.
// Everything else is optional and degrades gracefully when absent.

import { parseDelimited } from './csv';
import { normalizeCategory, normalizeHeader, type Buyer, type EventState } from './types';

interface ColumnSpec {
  field: string;
  required: boolean;
  // normalized header names that map to this field
  matches: string[];
  label: string; // human-readable, for error messages
}

const COLUMNS: ColumnSpec[] = [
  { field: 'transaction_id', required: true, matches: ['transactionid', 'invoiceid', 'invoicenumber'], label: 'Transaction ID' },
  { field: 'booking_code', required: true, matches: ['bookingcode'], label: 'Booking Code' },
  { field: 'ticket_code', required: true, matches: ['ticketcode'], label: 'Ticket Code' },
  { field: 'event_name', required: true, matches: ['eventname'], label: 'Event Name' },
  { field: 'ticket_name', required: true, matches: ['ticketname'], label: 'Ticket Name' },
  { field: 'booking_status', required: false, matches: ['bookingstatus'], label: 'Booking Status' },
  { field: 'ticket_status', required: false, matches: ['ticketstatus'], label: 'Ticket Status' },
  { field: 'transaction_date', required: false, matches: ['transactiondate', 'transactiondatetime'], label: 'Transaction Date' },
  { field: 'transaction_time', required: false, matches: ['transactiontime'], label: 'Transaction Time' },
  { field: 'uploaded_seat', required: false, matches: ['ticketseat', 'seat', 'seatlabel'], label: 'Ticket Seat' },
  { field: 'name', required: false, matches: ['username', 'nama', 'name', 'buyername'], label: 'Username / Nama' },
  { field: 'email', required: false, matches: ['email'], label: 'Email' },
  { field: 'entry_gate', required: false, matches: ['entrygate', 'gate'], label: 'Entry Gate' },
  { field: 'zone', required: false, matches: ['zone'], label: 'Zone' },
  { field: 'queue_number', required: false, matches: ['queuenumber', 'queue'], label: 'Queue Number' },
  { field: 'notes', required: false, matches: ['notes', 'note', 'catatan'], label: 'Notes' },
];

export interface BuyerParseResult {
  ok: boolean;
  missingRequired: string[]; // human labels
  missingOptional: string[]; // notable absent optional columns (statuses, ticket seat)
  detected: { label: string; header: string }[];
  unmappedTicketNames: string[]; // need an alias before import can finish
  buyers: Buyer[]; // only filled once ticket names are resolvable
  rowErrors: string[];
  duplicateCount: number;
  eventNameMismatch: string | null;
  summary: {
    total: number;
    unique: number;
    assignable: number;
    notAssignable: number;
    byCategory: Record<string, { assignable: number; total: number }>;
  } | null;
}

export function parseBuyerFile(
  text: string,
  state: EventState,
  sourceChannel: string,
  extraAliases: Record<string, string> = {},
): BuyerParseResult {
  const rows = parseDelimited(text);
  const result: BuyerParseResult = {
    ok: false,
    missingRequired: [],
    missingOptional: [],
    detected: [],
    unmappedTicketNames: [],
    buyers: [],
    rowErrors: [],
    duplicateCount: 0,
    eventNameMismatch: null,
    summary: null,
  };
  if (rows.length < 2) {
    result.rowErrors.push('The file needs a header row plus at least one data row.');
    return result;
  }

  // map headers -> column index
  const headers = rows[0].map(normalizeHeader);
  const colIndex: Record<string, number> = {};
  for (const spec of COLUMNS) {
    const idx = headers.findIndex((h) => spec.matches.includes(h));
    if (idx >= 0) {
      colIndex[spec.field] = idx;
      result.detected.push({ label: spec.label, header: rows[0][idx] });
    } else if (spec.required) {
      result.missingRequired.push(spec.label);
    }
  }
  if (result.missingRequired.length) return result;

  const hasStatuses = 'booking_status' in colIndex && 'ticket_status' in colIndex;
  if (!hasStatuses) result.missingOptional.push('Booking/Ticket Status — every ticket will be treated as seatable');
  if (!('uploaded_seat' in colIndex)) result.missingOptional.push('Ticket Seat — sync check with Retool not available for this file');
  if (!('transaction_date' in colIndex)) result.missingOptional.push('Transaction Date — first-come-first-served order falls back to file order');

  const get = (row: string[], field: string): string =>
    field in colIndex ? (row[colIndex[field]] ?? '').trim() : '';

  // resolve categories via alias table; collect unmapped ticket names
  const aliases: Record<string, string> = { ...state.info.category_aliases, ...extraAliases };
  const seatCategories = new Set(Object.values(state.seats).map((s) => s.category).filter(Boolean));
  const resolveCategory = (ticketName: string): string | null => {
    const key = normalizeCategory(ticketName);
    if (aliases[key]) return aliases[key];
    if (seatCategories.has(key)) return key;
    // auto-suggest: ticket name contains exactly one known category word
    const hits = [...seatCategories].filter((c) => key.includes(c));
    if (hits.length === 1) return hits[0];
    return null;
  };

  const assignableStatuses = state.info.assignable_statuses.map((s) => s.toLowerCase());
  const isAssignable = (bookingStatus: string, ticketStatus: string): boolean => {
    if (!hasStatuses) return true;
    const okBooking = assignableStatuses.includes(bookingStatus.toLowerCase());
    const okTicket = assignableStatuses.includes(ticketStatus.toLowerCase());
    return okBooking && okTicket;
  };

  const seen = new Set<string>();
  const unmapped = new Set<string>();
  const byCategory: Record<string, { assignable: number; total: number }> = {};
  let assignable = 0;
  let total = 0;
  let mismatchName: string | null = null;
  const baseIndex = state.buyerOrder.length;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.every((c) => !c.trim())) continue;
    total++;

    const ticketCode = get(row, 'ticket_code');
    const transactionId = get(row, 'transaction_id');
    const bookingCode = get(row, 'booking_code');
    const ticketName = get(row, 'ticket_name');
    const eventName = get(row, 'event_name');

    const missing: string[] = [];
    if (!ticketCode) missing.push('Ticket Code');
    if (!transactionId) missing.push('Transaction ID');
    if (!bookingCode) missing.push('Booking Code');
    if (!ticketName) missing.push('Ticket Name');
    if (missing.length) {
      result.rowErrors.push(`Row ${r + 1}: missing ${missing.join(', ')}`);
      continue;
    }
    if (seen.has(ticketCode)) {
      result.duplicateCount++;
      continue;
    }
    seen.add(ticketCode);

    if (eventName && state.info.name && eventName.toLowerCase() !== state.info.name.toLowerCase()) {
      mismatchName = eventName;
    }

    const category = resolveCategory(ticketName);
    if (category === null) {
      unmapped.add(ticketName);
      continue; // resolved after the user maps it; parse is re-run
    }
    if (category === 'IGNORE') continue;

    const bookingStatus = get(row, 'booking_status');
    const ticketStatus = get(row, 'ticket_status');
    const canAssign = isAssignable(bookingStatus, ticketStatus);
    if (canAssign) assignable++;
    if (!byCategory[category]) byCategory[category] = { assignable: 0, total: 0 };
    byCategory[category].total++;
    if (canAssign) byCategory[category].assignable++;

    const date = get(row, 'transaction_date');
    const time = get(row, 'transaction_time');

    const buyer: Buyer = {
      ticket_code: ticketCode,
      transaction_id: transactionId,
      booking_code: bookingCode,
      ticket_name: ticketName,
      event_name: eventName,
      category,
      assignable: canAssign,
      import_index: baseIndex + r,
      source_channel: sourceChannel,
    };
    if (bookingStatus) buyer.booking_status = bookingStatus;
    if (ticketStatus) buyer.ticket_status = ticketStatus;
    if (date || time) buyer.transaction_datetime = `${date} ${time}`.trim();
    const optionalFields: [keyof Buyer, string][] = [
      ['email', get(row, 'email')],
      ['name', get(row, 'name')],
      ['uploaded_seat', get(row, 'uploaded_seat')],
      ['entry_gate', get(row, 'entry_gate')],
      ['zone', get(row, 'zone')],
      ['queue_number', get(row, 'queue_number')],
      ['notes', get(row, 'notes')],
    ];
    for (const [field, value] of optionalFields) {
      if (value) (buyer as any)[field] = value;
    }
    result.buyers.push(buyer);
  }

  result.unmappedTicketNames = [...unmapped];
  result.eventNameMismatch = mismatchName;
  result.summary = {
    total,
    unique: seen.size,
    assignable,
    notAssignable: result.buyers.length - assignable,
    byCategory,
  };
  result.ok = result.unmappedTicketNames.length === 0 && result.buyers.length > 0;
  return result;
}
