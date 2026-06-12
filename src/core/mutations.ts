// ─── Discrete mutation architecture ──────────────────────────────────────────
// Every state change is a serializable Mutation applied through the pure
// reducer applyMutation(). The persisted mutation log is the source of truth:
// reload = replay. This is the seam that later becomes a backend sync layer —
// a server stores the same envelopes and other clients re-reduce them.

import type { Assignment, Buyer, EventInfo, EventState, RunInfo, Seat } from './types';

export type Mutation =
  // Event
  | { type: 'EVENT_CREATE'; info: EventInfo }
  | { type: 'EVENT_SETTINGS_UPDATE'; patch: Partial<EventInfo> }
  // Seat map
  | { type: 'SEATMAP_IMPORT'; seats: Seat[]; replace: boolean }
  | { type: 'SEAT_UPDATE'; seat_label: string; patch: Partial<Seat> }
  | { type: 'SEATS_BULK_UPDATE'; seat_labels: string[]; patch: Partial<Seat> }
  // Buyers
  | { type: 'BUYER_IMPORT'; buyers: Buyer[]; source_channel: string }
  // Assignments
  | { type: 'RUN_COMMIT'; run: RunInfo; pairs: { ticket_code: string; seat_label: string }[] }
  | { type: 'ASSIGN'; ticket_code: string; seat_label: string }
  | { type: 'UNASSIGN'; ticket_code: string }
  // Lifecycle
  | { type: 'APPROVE'; ticket_codes: string[] }
  | { type: 'UNLOCK'; ticket_codes: string[]; reason: string }
  | { type: 'MARK_UPLOADED'; ticket_codes: string[] };

export interface MutationEnvelope {
  id: string;
  event_id: string;
  seq: number; // monotonic per event — conflict-detection key for future multi-user
  at: string; // ISO timestamp
  by: string; // user identity; 'admin' until real auth exists
  mutation: Mutation;
}

export function describeMutation(m: Mutation): string {
  switch (m.type) {
    case 'EVENT_CREATE': return `Created event "${m.info.name}"`;
    case 'EVENT_SETTINGS_UPDATE': return 'Updated event settings';
    case 'SEATMAP_IMPORT': return `${m.replace ? 'Replaced' : 'Added'} seat map (${m.seats.length} seats)`;
    case 'SEAT_UPDATE': return `Edited seat ${m.seat_label}`;
    case 'SEATS_BULK_UPDATE': return `Edited ${m.seat_labels.length} seats (${Object.keys(m.patch).join(', ')})`;
    case 'BUYER_IMPORT': return `Imported ${m.buyers.length} buyers (${m.source_channel})`;
    case 'RUN_COMMIT': return `Auto-assignment run #${m.run.version} (${m.pairs.length} seats)`;
    case 'ASSIGN': return `Assigned ${m.ticket_code} to ${m.seat_label}`;
    case 'UNASSIGN': return `Removed seat from ${m.ticket_code}`;
    case 'APPROVE': return `Approved ${m.ticket_codes.length} seat(s)`;
    case 'UNLOCK': return `Unlocked ${m.ticket_codes.length} seat(s)`;
    case 'MARK_UPLOADED': return `Marked ${m.ticket_codes.length} seat(s) as uploaded`;
  }
}

/**
 * Pure reducer. Returns a NEW state object — never mutates the input.
 * `at` comes from the envelope so replay is deterministic.
 */
export function applyMutation(
  state: EventState | undefined,
  m: Mutation,
  env: { at: string },
): EventState {
  if (m.type === 'EVENT_CREATE') {
    return {
      info: m.info,
      seats: {},
      seatOrder: [],
      buyers: {},
      buyerOrder: [],
      assignments: {},
      runs: [],
    };
  }
  if (!state) throw new Error('Mutation applied before EVENT_CREATE');

  switch (m.type) {
    case 'EVENT_SETTINGS_UPDATE':
      return { ...state, info: { ...state.info, ...m.patch } };

    case 'SEATMAP_IMPORT': {
      const seats: Record<string, Seat> = m.replace ? {} : { ...state.seats };
      const seatOrder = m.replace ? [] : [...state.seatOrder];
      for (const s of m.seats) {
        if (!seats[s.seat_label]) seatOrder.push(s.seat_label);
        seats[s.seat_label] = s;
      }
      return { ...state, seats, seatOrder };
    }

    case 'SEAT_UPDATE': {
      const prev = state.seats[m.seat_label];
      if (!prev) return state;
      const next = { ...prev, ...m.patch };
      const seats = { ...state.seats };
      let seatOrder = state.seatOrder;
      if (m.patch.seat_label && m.patch.seat_label !== m.seat_label) {
        delete seats[m.seat_label];
        seats[next.seat_label] = next;
        seatOrder = state.seatOrder.map((l) => (l === m.seat_label ? next.seat_label : l));
        // keep any assignment pointing at the renamed seat
        const assignments = { ...state.assignments };
        for (const [tc, a] of Object.entries(assignments)) {
          if (a.seat_label === m.seat_label) assignments[tc] = { ...a, seat_label: next.seat_label };
        }
        return { ...state, seats, seatOrder, assignments };
      }
      seats[m.seat_label] = next;
      return { ...state, seats, seatOrder };
    }

    case 'SEATS_BULK_UPDATE': {
      // bulk edits never rename seats — keys must stay stable for assignments
      const { seat_label: _ignored, ...patch } = m.patch;
      const seats = { ...state.seats };
      for (const l of m.seat_labels) {
        const prev = seats[l];
        if (prev) seats[l] = { ...prev, ...patch };
      }
      return { ...state, seats };
    }

    case 'BUYER_IMPORT': {
      const buyers = { ...state.buyers };
      const buyerOrder = [...state.buyerOrder];
      for (const b of m.buyers) {
        if (!buyers[b.ticket_code]) buyerOrder.push(b.ticket_code);
        // upsert: re-imports refresh statuses/uploaded_seat but keep first-seen order
        const existing = buyers[b.ticket_code];
        buyers[b.ticket_code] = existing ? { ...b, import_index: existing.import_index } : b;
      }
      return { ...state, buyers, buyerOrder };
    }

    case 'RUN_COMMIT': {
      const assignments = { ...state.assignments };
      for (const p of m.pairs) {
        assignments[p.ticket_code] = {
          ticket_code: p.ticket_code,
          seat_label: p.seat_label,
          status: 'assigned',
          run_id: m.run.id,
          assigned_at: env.at,
        };
      }
      return { ...state, assignments, runs: [...state.runs, m.run] };
    }

    case 'ASSIGN': {
      const assignments = { ...state.assignments };
      assignments[m.ticket_code] = {
        ticket_code: m.ticket_code,
        seat_label: m.seat_label,
        status: 'assigned',
        run_id: 'manual',
        assigned_at: env.at,
      };
      return { ...state, assignments };
    }

    case 'UNASSIGN': {
      const assignments = { ...state.assignments };
      delete assignments[m.ticket_code];
      return { ...state, assignments };
    }

    case 'APPROVE': {
      const assignments = { ...state.assignments };
      for (const tc of m.ticket_codes) {
        const a = assignments[tc];
        if (a && a.status === 'assigned') assignments[tc] = { ...a, status: 'approved', approved_at: env.at };
      }
      return { ...state, assignments };
    }

    case 'UNLOCK': {
      const assignments = { ...state.assignments };
      for (const tc of m.ticket_codes) {
        const a = assignments[tc];
        if (a && a.status !== 'assigned') assignments[tc] = { ...a, status: 'assigned' };
      }
      return { ...state, assignments };
    }

    case 'MARK_UPLOADED': {
      const assignments = { ...state.assignments };
      for (const tc of m.ticket_codes) {
        const a = assignments[tc];
        if (a && a.status === 'approved') assignments[tc] = { ...a, status: 'uploaded', uploaded_at: env.at };
      }
      return { ...state, assignments };
    }
  }
}

/** Rebuild state by replaying the mutation log. Reload safety = this function. */
export function replay(envelopes: MutationEnvelope[]): EventState | undefined {
  let state: EventState | undefined;
  for (const env of [...envelopes].sort((a, b) => a.seq - b.seq)) {
    state = applyMutation(state, env.mutation, env);
  }
  return state;
}
