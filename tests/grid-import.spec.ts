import { describe, expect, it } from 'vitest';
import { buildSeatsFromGrid } from '../src/core/grid-import';

describe('refs mode', () => {
  it('imports without a category — paint areas on the map afterwards', () => {
    const r = buildSeatsFromGrid(
      [['T1-2', 'T1-1'], ['S1-2', 'S1-1']],
      { mode: 'refs', firstRowIsFront: true },
    );
    expect(r.problems.filter((p) => p.level === 'error')).toHaveLength(0);
    expect(r.seats).toHaveLength(4);
    expect(r.seats[0].seat_label).toBe('T1-2');
    expect(r.seats[0].display_label).toBe('T1-2');
    expect(r.seats[0].category).toBe('');
    expect(r.seats[0].row_name).toBe('T1');
    // a warning nudges the admin to set categories on the map
    expect(r.problems.some((p) => p.level === 'warning')).toBe(true);
  });

  it('prefixes the internal key with the category when one is given', () => {
    const r = buildSeatsFromGrid([['A-1']], { mode: 'refs', category: 'GOLD', firstRowIsFront: true });
    expect(r.seats[0].seat_label).toBe('GOLD-A-1');
    expect(r.seats[0].display_label).toBe('A-1');
    expect(r.seats[0].category).toBe('GOLD');
  });

  it('keeps duplicate references as separate seats with unique internal keys', () => {
    const r = buildSeatsFromGrid([['P2-6', '', 'P2-6']], { mode: 'refs', firstRowIsFront: true });
    expect(r.seats.map((s) => s.seat_label)).toEqual(['P2-6', 'P2-6~2']);
    expect(r.seats[1].display_label).toBe('P2-6'); // export label unchanged
    expect(r.problems.filter((p) => p.level === 'error')).toHaveLength(0);
    expect(r.problems.some((p) => p.level === 'warning' && p.message.includes('P2-6'))).toBe(true);
  });

  it('skips decoration cells (gates, bare numbers) and splits segments there', () => {
    const r = buildSeatsFromGrid(
      [['A-1', 'PINTU 10', 'A-2']],
      { mode: 'refs', skipNonRefs: true, firstRowIsFront: true },
    );
    expect(r.seats).toHaveLength(2);
    expect(r.skipped).toEqual(['PINTU 10']);
    // the gate splits the row into two segments — no booking spans a walkway
    expect(r.seats[0].segment_id).not.toBe(r.seats[1].segment_id);
  });

  it('imports decoration cells as seats when skipping is off', () => {
    const r = buildSeatsFromGrid([['A-1', '14']], { mode: 'refs', firstRowIsFront: true });
    expect(r.seats).toHaveLength(2);
    expect(r.skipped).toHaveLength(0);
  });
});

describe('labels and numbers modes keep strict uniqueness', () => {
  it('labels mode still errors on duplicates', () => {
    const r = buildSeatsFromGrid(
      [['GOLD-A1-1', 'GOLD-A1-1']],
      { mode: 'labels', firstRowIsFront: true },
    );
    expect(r.problems.some((p) => p.level === 'error' && p.message.includes('Duplicate'))).toBe(true);
  });

  it('numbers mode still requires a category', () => {
    const r = buildSeatsFromGrid([['1', '2']], { mode: 'numbers', firstRowIsFront: true });
    expect(r.problems.some((p) => p.level === 'error' && p.message.includes('category'))).toBe(true);
  });
});
