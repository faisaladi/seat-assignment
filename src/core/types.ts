// ─── Domain types ────────────────────────────────────────────────────────────
// All state lives in EventState and is only changed through Mutations
// (see mutations.ts). Keep every type here JSON-serializable.

export type SeatStatus = 'available' | 'blocked' | 'restricted' | 'held' | 'damaged';
export type AssignmentStatus = 'assigned' | 'approved' | 'uploaded';

export interface EventInfo {
  id: string;
  name: string;
  event_uid: string; // Retool event UID, goes on every export row
  venue: string;
  event_date: string; // free text, informational
  notes_template: string; // pre-fills the notes column on export
  assignable_statuses: string[]; // lowercase; buyer is seatable when statuses match (or columns absent)
  category_aliases: Record<string, string>; // normalized ticket name -> seat category
  created_at: string;
}

export interface Seat {
  seat_label: string; // unique within event — the Retool contract key
  category: string; // normalized, e.g. GOLD
  priority: number; // 1 = best seat, filled first
  status: SeatStatus;
  segment_id: string; // contiguous run of seats in one row; adjacency exists only within
  grid_x: number; // column in the pasted grid — adjacency source of truth
  grid_y: number; // row in the pasted grid
  row_name: string;
  zone?: string;
  notes?: string;
}

export interface Buyer {
  ticket_code: string; // unique — dedup key; ticket_id on export
  transaction_id: string; // invoice_id on export
  booking_code: string; // group key — these people sit together
  ticket_name: string; // raw ticket name from Retool
  event_name: string;
  category: string; // resolved via alias table
  assignable: boolean;
  import_index: number; // original file order, used as FCFS tie-break
  source_channel: string;
  // Optional columns — absent from the file means undefined
  booking_status?: string;
  ticket_status?: string;
  transaction_datetime?: string;
  email?: string;
  name?: string;
  uploaded_seat?: string; // Retool's "Ticket Seat" at import time
  entry_gate?: string;
  zone?: string;
  queue_number?: string;
  notes?: string;
}

export interface Assignment {
  ticket_code: string;
  seat_label: string;
  status: AssignmentStatus;
  run_id: string; // 'manual' for hand-placed seats
  assigned_at: string;
  approved_at?: string;
  uploaded_at?: string;
}

export interface RunInfo {
  id: string;
  version: number;
  categories: string[];
  created_at: string;
  stats: {
    groups: number;
    assignedGroups: number;
    tickets: number;
    contiguous: number;
    sameRowSplit: number;
    crossSplit: number;
  };
  unassigned: { booking_code: string; category: string; quantity: number; reason: string }[];
}

export interface EventState {
  info: EventInfo;
  seats: Record<string, Seat>;
  seatOrder: string[]; // labels in map order (grid_y, then grid_x)
  buyers: Record<string, Buyer>;
  buyerOrder: string[];
  assignments: Record<string, Assignment>; // keyed by ticket_code
  runs: RunInfo[];
}

// ─── Helpers shared across modules ──────────────────────────────────────────

export function normalizeCategory(raw: string): string {
  return (raw || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

export function normalizeHeader(raw: string): string {
  return (raw || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function seatsInOrder(state: EventState): Seat[] {
  return state.seatOrder.map((l) => state.seats[l]).filter(Boolean);
}

export function seatByAssignment(state: EventState): Record<string, Assignment> {
  // seat_label -> assignment (for occupancy lookups)
  const out: Record<string, Assignment> = {};
  for (const a of Object.values(state.assignments)) out[a.seat_label] = a;
  return out;
}

export const DEFAULT_ASSIGNABLE_STATUSES = [
  'paid',
  'active',
  'success',
  'confirmed',
  'completed',
  'issued',
];
