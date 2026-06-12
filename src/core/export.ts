// Export builders. The Retool Upload file is the contract:
// event_uid, invoice_id, booking_code, ticket_id, seat_label, notes

import { serializeDelimited } from './csv';
import { qcCounts, runQc } from './qc';
import type { EventState } from './types';

export interface ExportCheck {
  ok: boolean;
  problems: string[];
  approvedCount: number;
  notApprovedCount: number;
}

export function checkRetoolExport(state: EventState): ExportCheck {
  const problems: string[] = [];
  const all = Object.values(state.assignments);
  const approved = all.filter((a) => a.status === 'approved');
  const notApproved = all.filter((a) => a.status === 'assigned');

  if (!state.info.event_uid.trim()) {
    problems.push('The event is missing its Retool event UID. Add it in Event settings before exporting.');
  }
  const counts = qcCounts(runQc(state));
  if (counts.block > 0) {
    problems.push(`There are ${counts.block} blocking issue(s) in Review. Fix them before exporting.`);
  }
  if (approved.length === 0) {
    problems.push('No approved seats yet. Approve seats in the Review step first — only approved seats are exported.');
  }
  return { ok: problems.length === 0, problems, approvedCount: approved.length, notApprovedCount: notApproved.length };
}

export function buildRetoolUpload(
  state: EventState,
  notes: string,
  format: 'tsv' | 'csv',
): { filename: string; content: string; mime: string; ticketCodes: string[] } {
  const rows: string[][] = [['event_uid', 'invoice_id', 'booking_code', 'ticket_id', 'seat_label', 'notes']];
  const ticketCodes: string[] = [];
  for (const tc of state.buyerOrder) {
    const a = state.assignments[tc];
    if (!a || a.status !== 'approved') continue;
    const b = state.buyers[tc];
    if (!b) continue;
    const exportLabel = state.seats[a.seat_label]?.display_label ?? a.seat_label;
    rows.push([state.info.event_uid, b.transaction_id, b.booking_code, b.ticket_code, exportLabel, notes]);
    ticketCodes.push(tc);
  }
  const delimiter = format === 'tsv' ? '\t' : ',';
  const safeName = state.info.name.replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase() || 'event';
  return {
    filename: `${safeName}_seat_upload.${format}`,
    content: serializeDelimited(rows, delimiter),
    mime: format === 'tsv' ? 'text/tab-separated-values' : 'text/csv',
    ticketCodes,
  };
}

export function buildErrorReport(state: EventState): { filename: string; content: string; mime: string } | null {
  const lastRun = state.runs[state.runs.length - 1];
  if (!lastRun || lastRun.unassigned.length === 0) return null;
  const rows: string[][] = [['booking_code', 'category', 'quantity', 'reason']];
  for (const u of lastRun.unassigned) {
    rows.push([u.booking_code, u.category, String(u.quantity), u.reason]);
  }
  return { filename: 'unassigned_report.csv', content: serializeDelimited(rows, ','), mime: 'text/csv' };
}

export function buildFullAssignment(state: EventState): { filename: string; content: string; mime: string } {
  const rows: string[][] = [['Seat Label', 'Category', 'Row', 'Status', 'Ticket Code', 'Booking Code', 'Buyer', 'Assignment Status']];
  const bySeat = new Map(Object.values(state.assignments).map((a) => [a.seat_label, a]));
  for (const label of state.seatOrder) {
    const s = state.seats[label];
    const a = bySeat.get(label);
    const b = a ? state.buyers[a.ticket_code] : undefined;
    rows.push([
      s.seat_label,
      s.category,
      s.row_name,
      s.status,
      a?.ticket_code ?? '',
      b?.booking_code ?? '',
      b?.name ?? '',
      a?.status ?? '',
    ]);
  }
  return { filename: 'full_assignment.csv', content: serializeDelimited(rows, ','), mime: 'text/csv' };
}
