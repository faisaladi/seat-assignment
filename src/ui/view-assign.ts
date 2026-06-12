// Step 4 — Auto-assign: pick categories, preview what the engine proposes,
// then commit. Nothing changes until "Use these seats" is clicked.
// Already-seated tickets (incl. approved/uploaded) are never moved.

import { runEngine, type EngineResult } from '../core/engine';
import type { RunInfo } from '../core/types';
import type { Store } from '../store/store';
import { emptyState, h, toast } from './components';

export function viewAssign(store: Store): { el: HTMLElement; update: () => void } {
  const el = h('div', {});
  let preview: EngineResult | null = null;
  let previewCategories: string[] = [];

  function render(): void {
    el.innerHTML = '';
    const state = store.state;
    if (!state) return;

    const buyers = Object.values(state.buyers);
    if (state.seatOrder.length === 0 || buyers.length === 0) {
      el.append(emptyState('🪄', 'Almost there', [
        state.seatOrder.length === 0 ? 'First set up the seat map (step 2).' : 'Seat map is ready ✓',
        buyers.length === 0 ? 'Then import buyers (step 3).' : 'Buyers are imported ✓',
      ]));
      return;
    }

    // per-category balance
    const categories = [...new Set(state.seatOrder.map((l) => state.seats[l].category).filter(Boolean))];
    const occupied = new Set(Object.values(state.assignments).map((a) => a.seat_label));
    const checks: Record<string, HTMLInputElement> = {};

    const rows = categories.map((cat) => {
      const waiting = buyers.filter((b) => b.assignable && b.category === cat && !state.assignments[b.ticket_code]).length;
      const free = state.seatOrder.filter((l) => {
        const s = state.seats[l];
        return s.category === cat && (s.status === 'available' || s.status === 'restricted') && !occupied.has(l);
      }).length;
      const check = h('input', { type: 'checkbox', checked: waiting > 0 }) as HTMLInputElement;
      checks[cat] = check;
      return h('tr', {},
        h('td', {}, check),
        h('td', {}, h('strong', {}, cat)),
        h('td', {}, String(waiting)),
        h('td', {}, String(free)),
        h('td', {}, waiting > free
          ? h('span', { class: 'pill pill-red' }, `${waiting - free} won't fit`)
          : waiting === 0
            ? h('span', { class: 'pill pill-grey' }, 'nothing to do')
            : h('span', { class: 'pill pill-green' }, 'ok')),
      );
    });

    el.append(
      h('div', { class: 'card' },
        h('h3', {}, 'Assign seats automatically'),
        h('p', { class: 'lead' },
          'The app gives every booking seats together where possible, starting from the best seats. People who bought together (same Booking Code) sit side by side. Seats that are already assigned or approved are never touched.'),
        h('table', { class: 'data' },
          h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Category'), h('th', {}, 'Waiting for a seat'), h('th', {}, 'Free seats'), h('th', {}, ''))),
          h('tbody', {}, ...rows),
        ),
        h('div', { class: 'btn-row' },
          h('button', {
            class: 'btn btn-primary',
            onClick: () => {
              const selected = categories.filter((c) => checks[c].checked);
              if (!selected.length) {
                toast('Tick at least one category', 'error');
                return;
              }
              preview = runEngine(state, selected);
              previewCategories = selected;
              render();
            },
          }, '▶ Preview assignment'),
        ),
      ),
    );

    if (preview) el.append(renderPreview(preview));

    // past runs
    if (state.runs.length) {
      el.append(
        h('div', { class: 'card' },
          h('h3', {}, 'Past runs'),
          h('table', { class: 'data' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Run'), h('th', {}, 'When'), h('th', {}, 'Categories'), h('th', {}, 'Seats given'), h('th', {}, 'Could not fit'))),
            h('tbody', {},
              ...state.runs.map((r) =>
                h('tr', {},
                  h('td', {}, `#${r.version}`),
                  h('td', { class: 'muted' }, new Date(r.created_at).toLocaleString()),
                  h('td', {}, r.categories.join(', ')),
                  h('td', {}, String(r.stats.tickets)),
                  h('td', {}, String(r.unassigned.reduce((s, u) => s + u.quantity, 0))),
                ),
              ),
            ),
          ),
        ),
      );
    }
  }

  function renderPreview(p: EngineResult): HTMLElement {
    const ok = p.stats.assignedGroups;
    const totalTix = p.stats.tickets;

    const qualityPill = (q: string) =>
      q === 'contiguous' || q === 'single'
        ? h('span', { class: 'pill pill-green' }, q === 'single' ? 'single seat' : 'together')
        : q === 'same-row split'
          ? h('span', { class: 'pill pill-amber' }, 'same row, small gap')
          : h('span', { class: 'pill pill-red' }, 'split across rows');

    return h('div', { class: 'card', style: 'border-color:#93c5fd' },
      h('h3', {}, 'Preview — nothing is saved yet'),
      h('div', { class: 'stat-grid' },
        stat(String(totalTix), 'seats proposed'),
        stat(`${ok}/${p.stats.groups}`, 'groups placed'),
        stat(String(p.stats.contiguous), 'groups fully together'),
        stat(String(p.stats.sameRowSplit + p.stats.crossSplit), 'groups split'),
        stat(String(p.unassigned.reduce((s, u) => s + u.quantity, 0)), 'could not fit'),
      ),
      p.unassigned.length
        ? h('div', { class: 'notice notice-warn' },
            h('strong', {}, `${p.unassigned.length} group(s) could not be placed: `),
            p.unassigned.slice(0, 4).map((u) => `${u.booking_code} (${u.quantity}× ${u.category}) — ${u.reason}`).join(' · '),
            p.unassigned.length > 4 ? ` · and ${p.unassigned.length - 4} more (full list in the Export step)` : '')
        : h('div', { class: 'notice notice-ok' }, 'Everyone fits ✓'),
      h('div', { style: 'max-height:300px;overflow:auto' },
        h('table', { class: 'data' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Booking'), h('th', {}, 'Buyer'), h('th', {}, 'Category'), h('th', {}, 'Seats'), h('th', {}, ''))),
          h('tbody', {},
            ...p.groups.map((g) =>
              h('tr', {},
                h('td', {}, g.booking_code),
                h('td', {}, g.buyer_name ?? ''),
                h('td', {}, g.category),
                h('td', {}, g.seats.join(', ')),
                h('td', {}, qualityPill(g.quality)),
              ),
            ),
          ),
        ),
      ),
      h('div', { class: 'btn-row' },
        h('button', {
          class: 'btn btn-green',
          onClick: async () => {
            const state = store.state!;
            const run: RunInfo = {
              id: crypto.randomUUID(),
              version: state.runs.length + 1,
              categories: previewCategories,
              created_at: new Date().toISOString(),
              stats: p.stats,
              unassigned: p.unassigned,
            };
            await store.dispatch({ type: 'RUN_COMMIT', run, pairs: p.pairs });
            preview = null;
            toast(`${p.pairs.length} seats assigned. Next: check them in Review (step 5).`, 'ok');
            render();
          },
        }, `✓ Use these seats (${p.pairs.length})`),
        h('button', { class: 'btn', onClick: () => { preview = null; render(); } }, 'Discard preview'),
      ),
    );
  }

  function stat(num: string, label: string): HTMLElement {
    return h('div', { class: 'stat' }, h('div', { class: 'stat-num' }, num), h('div', { class: 'stat-label' }, label));
  }

  render();
  return { el, update: render };
}
