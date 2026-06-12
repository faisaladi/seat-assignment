import { describe, expect, it } from 'vitest';
import { applyMutation, replay, type Mutation, type MutationEnvelope } from '../src/core/mutations';
import { DEFAULT_ASSIGNABLE_STATUSES, type EventInfo, type Seat, type Buyer } from '../src/core/types';

const info: EventInfo = {
  id: 'ev1',
  name: 'Test Concert',
  event_uid: 'uid-123',
  venue: '',
  event_date: '',
  notes_template: 'note',
  assignable_statuses: DEFAULT_ASSIGNABLE_STATUSES,
  category_aliases: {},
  created_at: '2026-06-11T00:00:00Z',
};

function seat(label: string, x: number, y: number, category = 'GOLD'): Seat {
  return {
    seat_label: label, category, priority: y + 1, status: 'available',
    segment_id: `y${y}s0`, grid_x: x, grid_y: y, row_name: `A${y + 1}`,
  };
}

function buyer(tc: string, booking: string, idx: number, category = 'GOLD'): Buyer {
  return {
    ticket_code: tc, transaction_id: `tx-${tc}`, booking_code: booking,
    ticket_name: 'Gold', event_name: 'Test Concert', category,
    assignable: true, import_index: idx, source_channel: 'test',
  };
}

function envelope(seq: number, mutation: Mutation): MutationEnvelope {
  return { id: `m${seq}`, event_id: 'ev1', seq, at: `2026-06-11T00:00:0${seq}Z`, by: 'test', mutation };
}

describe('mutation reducer', () => {
  it('replays a full lifecycle deterministically', () => {
    const log: MutationEnvelope[] = [
      envelope(1, { type: 'EVENT_CREATE', info }),
      envelope(2, { type: 'SEATMAP_IMPORT', seats: [seat('GOLD-A1-1', 0, 0), seat('GOLD-A1-2', 1, 0)], replace: false }),
      envelope(3, { type: 'BUYER_IMPORT', buyers: [buyer('T1', 'B1', 0)], source_channel: 'test' }),
      envelope(4, { type: 'ASSIGN', ticket_code: 'T1', seat_label: 'GOLD-A1-1' }),
      envelope(5, { type: 'APPROVE', ticket_codes: ['T1'] }),
      envelope(6, { type: 'MARK_UPLOADED', ticket_codes: ['T1'] }),
    ];
    const state = replay(log)!;
    expect(state.seatOrder).toHaveLength(2);
    expect(state.assignments['T1'].status).toBe('uploaded');
    expect(state.assignments['T1'].seat_label).toBe('GOLD-A1-1');

    // replay is deterministic: same log -> same state
    expect(replay(log)).toEqual(state);
  });

  it('never mutates the previous state', () => {
    let state = applyMutation(undefined, { type: 'EVENT_CREATE', info }, { at: 't' });
    const before = JSON.parse(JSON.stringify(state));
    applyMutation(state, { type: 'SEATMAP_IMPORT', seats: [seat('S1', 0, 0)], replace: false }, { at: 't' });
    expect(state).toEqual(before);
  });

  it('unassign frees the seat, unlock reverts approval', () => {
    let state = applyMutation(undefined, { type: 'EVENT_CREATE', info }, { at: 't' });
    state = applyMutation(state, { type: 'SEATMAP_IMPORT', seats: [seat('S1', 0, 0)], replace: false }, { at: 't' });
    state = applyMutation(state, { type: 'BUYER_IMPORT', buyers: [buyer('T1', 'B1', 0)], source_channel: 'x' }, { at: 't' });
    state = applyMutation(state, { type: 'ASSIGN', ticket_code: 'T1', seat_label: 'S1' }, { at: 't' });
    state = applyMutation(state, { type: 'APPROVE', ticket_codes: ['T1'] }, { at: 't' });
    expect(state.assignments['T1'].status).toBe('approved');
    state = applyMutation(state, { type: 'UNLOCK', ticket_codes: ['T1'], reason: 'test' }, { at: 't' });
    expect(state.assignments['T1'].status).toBe('assigned');
    state = applyMutation(state, { type: 'UNASSIGN', ticket_code: 'T1' }, { at: 't' });
    expect(state.assignments['T1']).toBeUndefined();
  });

  it('re-import upserts buyers without duplicating', () => {
    let state = applyMutation(undefined, { type: 'EVENT_CREATE', info }, { at: 't' });
    state = applyMutation(state, { type: 'BUYER_IMPORT', buyers: [buyer('T1', 'B1', 0)], source_channel: 'wave1' }, { at: 't' });
    const updated = { ...buyer('T1', 'B1', 99), booking_status: 'refunded', assignable: false };
    state = applyMutation(state, { type: 'BUYER_IMPORT', buyers: [updated], source_channel: 'wave2' }, { at: 't' });
    expect(state.buyerOrder).toHaveLength(1);
    expect(state.buyers['T1'].assignable).toBe(false);
    expect(state.buyers['T1'].import_index).toBe(0); // keeps original order
  });
});
