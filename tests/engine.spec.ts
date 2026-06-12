import { describe, expect, it } from 'vitest';
import { runEngine } from '../src/core/engine';
import { applyMutation } from '../src/core/mutations';
import {
  DEFAULT_ASSIGNABLE_STATUSES,
  type Buyer,
  type EventInfo,
  type EventState,
  type Seat,
} from '../src/core/types';

const info: EventInfo = {
  id: 'ev1', name: 'Test', event_uid: 'u', venue: '', event_date: '',
  notes_template: '', assignable_statuses: DEFAULT_ASSIGNABLE_STATUSES,
  category_aliases: {}, created_at: 't',
};

function seat(label: string, x: number, y: number, opts: Partial<Seat> = {}): Seat {
  return {
    seat_label: label, category: 'GOLD', priority: y + 1, status: 'available',
    segment_id: `y${y}s${opts.segment_id ?? 0}`, grid_x: x, grid_y: y, row_name: `A${y + 1}`,
    ...opts,
  };
}

function buyer(tc: string, booking: string, idx: number, opts: Partial<Buyer> = {}): Buyer {
  return {
    ticket_code: tc, transaction_id: `tx${tc}`, booking_code: booking, ticket_name: 'Gold',
    event_name: 'Test', category: 'GOLD', assignable: true, import_index: idx, source_channel: 't',
    ...opts,
  };
}

function makeState(seats: Seat[], buyers: Buyer[]): EventState {
  let state = applyMutation(undefined, { type: 'EVENT_CREATE', info }, { at: 't' });
  state = applyMutation(state, { type: 'SEATMAP_IMPORT', seats, replace: false }, { at: 't' });
  state = applyMutation(state, { type: 'BUYER_IMPORT', buyers, source_channel: 't' }, { at: 't' });
  return state;
}

// one row of 10 seats: GOLD-A1-1 .. GOLD-A1-10
const row10 = Array.from({ length: 10 }, (_, i) => seat(`GOLD-A1-${i + 1}`, i, 0));

describe('assignment engine', () => {
  it('keeps a booking together in one contiguous block', () => {
    const state = makeState(row10, [
      buyer('T1', 'B1', 0), buyer('T2', 'B1', 1), buyer('T3', 'B1', 2),
      buyer('T4', 'B2', 3), buyer('T5', 'B2', 4),
    ]);
    const r = runEngine(state, ['GOLD']);
    expect(r.pairs).toHaveLength(5);
    expect(r.stats.contiguous).toBe(2);
    expect(r.unassigned).toHaveLength(0);

    // B1's three seats must be adjacent
    const b1Seats = r.pairs.filter((p) => ['T1', 'T2', 'T3'].includes(p.ticket_code)).map((p) => state.seats[p.seat_label].grid_x).sort((a, b) => a - b);
    expect(b1Seats[2] - b1Seats[0]).toBe(2);
  });

  it('never crosses an aisle (segment boundary)', () => {
    // two segments of 3 seats each, group of 4 cannot fit in one
    const seats = [
      seat('GOLD-A1-1', 0, 0, { segment_id: 'a' }),
      seat('GOLD-A1-2', 1, 0, { segment_id: 'a' }),
      seat('GOLD-A1-3', 2, 0, { segment_id: 'a' }),
      seat('GOLD-A1-4', 5, 0, { segment_id: 'b' }),
      seat('GOLD-A1-5', 6, 0, { segment_id: 'b' }),
      seat('GOLD-A1-6', 7, 0, { segment_id: 'b' }),
    ];
    const state = makeState(seats, [buyer('T1', 'B1', 0), buyer('T2', 'B1', 1), buyer('T3', 'B1', 2), buyer('T4', 'B1', 3)]);
    const r = runEngine(state, ['GOLD']);
    // group of 4 must be split (no 4-seat contiguous run exists), not seated across the aisle as "contiguous"
    expect(r.pairs).toHaveLength(4);
    expect(r.stats.contiguous).toBe(0);
  });

  it('never assigns blocked, damaged or held seats', () => {
    const seats = [
      seat('S1', 0, 0, { status: 'blocked' }),
      seat('S2', 1, 0, { status: 'damaged' }),
      seat('S3', 2, 0, { status: 'held' }),
      seat('S4', 3, 0),
    ];
    const state = makeState(seats, [buyer('T1', 'B1', 0), buyer('T2', 'B2', 1)]);
    const r = runEngine(state, ['GOLD']);
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0].seat_label).toBe('S4');
    expect(r.unassigned).toHaveLength(1);
  });

  it('never touches existing assignments (locked seats)', () => {
    let state = makeState(row10, [buyer('T1', 'B1', 0), buyer('T2', 'B2', 1)]);
    state = applyMutation(state, { type: 'ASSIGN', ticket_code: 'T1', seat_label: 'GOLD-A1-1' }, { at: 't' });
    state = applyMutation(state, { type: 'APPROVE', ticket_codes: ['T1'] }, { at: 't' });
    const r = runEngine(state, ['GOLD']);
    // T1 already seated -> only T2 gets a new seat, and not on T1's seat
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0].ticket_code).toBe('T2');
    expect(r.pairs[0].seat_label).not.toBe('GOLD-A1-1');
  });

  it('prefers better-priority seats and uses restricted seats last', () => {
    const seats = [
      seat('FRONT', 0, 0, { priority: 1 }),
      seat('BACK', 0, 1, { priority: 2 }),
      seat('RESTR', 1, 0, { priority: 1, status: 'restricted' }),
    ];
    const state = makeState(seats, [buyer('T1', 'B1', 0)]);
    const r = runEngine(state, ['GOLD']);
    expect(r.pairs[0].seat_label).toBe('FRONT');
  });

  it('respects category boundaries', () => {
    const seats = [seat('G1', 0, 0), seat('D1', 0, 1, { category: 'DIAMOND' })];
    const state = makeState(seats, [buyer('T1', 'B1', 0, { category: 'DIAMOND' })]);
    const r = runEngine(state, ['DIAMOND']);
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0].seat_label).toBe('D1');
  });

  it('splits medium groups within the same row before crossing rows', () => {
    // row 0 has two segments of 3; row 1 has 6 contiguous — a group of 6 fits row 1,
    // then a group of 5 must split 3+2 in row 0
    const seats = [
      ...[0, 1, 2].map((x) => seat(`R0A-${x}`, x, 0, { segment_id: 'r0a' })),
      ...[5, 6, 7].map((x) => seat(`R0B-${x}`, x, 0, { segment_id: 'r0b' })),
      ...[0, 1, 2, 3, 4, 5].map((x) => seat(`R1-${x}`, x, 1, { segment_id: 'r1' })),
    ];
    const six = Array.from({ length: 6 }, (_, i) => buyer(`S${i}`, 'BIG', i));
    const five = Array.from({ length: 5 }, (_, i) => buyer(`F${i}`, 'FIVE', 10 + i));
    const state = makeState(seats, [...six, ...five]);
    const r = runEngine(state, ['GOLD']);
    expect(r.unassigned).toHaveLength(0);
    const fiveGroup = r.groups.find((g) => g.booking_code === 'FIVE')!;
    expect(fiveGroup.quality).toBe('same-row split');
  });
});
