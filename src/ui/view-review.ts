// Step 5 — Review & approve: quality checks, fix seats by hand on the map,
// then approve. Approval locks seats so later runs never move them.

import { qcCounts, runQc, type QcIssue } from '../core/qc';
import { seatByAssignment } from '../core/types';
import type { Store } from '../store/store';
import { confirmDialog, emptyState, h, toast } from './components';
import { createSeatMap } from './map-canvas';

export function viewReview(store: Store): { el: HTMLElement; update: () => void } {
  const el = h('div', { style: 'height:100%;display:flex;flex-direction:column' });
  let map: ReturnType<typeof createSeatMap> | null = null;
  let sidePanel: HTMLElement | null = null;
  let headerBox: HTMLElement | null = null;
  let activeTab: 'qc' | 'seat' = 'qc';
  let selectedSeat: string | null = null;

  function render(): void {
    el.innerHTML = '';
    map = null;
    const state = store.state;
    if (!state) return;

    if (Object.keys(state.assignments).length === 0) {
      el.append(emptyState('🔍', 'Nothing to review yet', [
        'Once seats are assigned (step 4), come back here to check the result, fix seats by hand, and approve.',
      ]));
      return;
    }

    headerBox = h('div', {});
    sidePanel = h('div', { class: 'split-side' });
    map = createSeatMap(() => store.state, {
      onSelect: (label) => {
        selectedSeat = label;
        activeTab = 'seat';
        renderSide(runQc(store.state!));
      },
    });

    renderHeader();
    renderSide(runQc(state));

    el.append(headerBox, h('div', { class: 'split', style: 'flex:1;min-height:0' },
      h('div', { class: 'split-main' }, map.el),
      sidePanel,
    ));
    requestAnimationFrame(() => map?.update());
  }

  function renderHeader(): void {
    if (!headerBox) return;
    headerBox.innerHTML = '';
    const state = store.state!;
    const issues = runQc(state);
    const counts = qcCounts(issues);
    const assignments = Object.values(state.assignments);
    const assigned = assignments.filter((a) => a.status === 'assigned');
    const approved = assignments.filter((a) => a.status === 'approved');
    const uploaded = assignments.filter((a) => a.status === 'uploaded');

    const header = h('div', { class: 'card', style: 'margin-bottom:12px' },
      h('div', { style: 'display:flex;align-items:center;gap:12px;flex-wrap:wrap' },
        counts.block > 0
          ? h('span', { class: 'pill pill-red' }, `${counts.block} must-fix`)
          : h('span', { class: 'pill pill-green' }, '✓ no blocking problems'),
        h('span', { class: 'pill pill-amber' }, `${counts.warn} warnings`),
        h('span', { class: 'pill pill-grey' }, `${counts.info} notes`),
        h('span', { style: 'flex:1' }),
        h('span', { class: 'pill pill-blue' }, `${assigned.length} assigned`),
        h('span', { class: 'pill pill-green' }, `${approved.length} approved`),
        uploaded.length ? h('span', { class: 'pill pill-teal' }, `${uploaded.length} uploaded`) : null,
        h('button', {
          class: 'btn btn-green',
          disabled: counts.block > 0 || assigned.length === 0,
          title: counts.block > 0 ? 'Fix the must-fix problems first' : '',
          onClick: async () => {
            const ok = await confirmDialog(
              'Approve these seats?',
              `${assigned.length} seat(s) will be locked. Locked seats are final: automatic runs never move them, and they become ready for export. You can unlock later if needed.`,
              `Approve ${assigned.length} seat(s)`,
            );
            if (ok) {
              await store.dispatch({ type: 'APPROVE', ticket_codes: assigned.map((a) => a.ticket_code) });
              toast('Approved ✓ Next: Export (step 6)', 'ok');
            }
          },
        }, `✓ Approve ${assigned.length} assigned seat(s)`),
        approved.length
          ? h('button', {
              class: 'btn',
              onClick: async () => {
                const ok = await confirmDialog('Unlock approved seats?', 'They go back to "assigned" and can be changed again.', 'Unlock');
                if (ok) await store.dispatch({ type: 'UNLOCK', ticket_codes: approved.map((a) => a.ticket_code), reason: 'manual unlock' });
              },
            }, 'Unlock approved')
          : null,
      ),
      counts.block > 0
        ? h('div', { class: 'notice notice-error', style: 'margin:10px 0 0' },
            'There are problems that must be fixed before you can approve or export. Click each one in the list to see the seats on the map.')
        : null,
    );
    headerBox.append(header);
  }

  function renderSide(issues: QcIssue[]): void {
    if (!sidePanel) return;
    sidePanel.innerHTML = '';

    const tabs = h('div', { class: 'btn-row', style: 'margin:0 0 10px' },
      h('button', { class: `btn ${activeTab === 'qc' ? 'btn-primary' : ''}`, onClick: () => { activeTab = 'qc'; renderSide(issues); } }, `Checks (${issues.length})`),
      h('button', { class: `btn ${activeTab === 'seat' ? 'btn-primary' : ''}`, onClick: () => { activeTab = 'seat'; renderSide(issues); } }, 'Selected seat'),
    );
    sidePanel.append(tabs);

    if (activeTab === 'qc') {
      if (!issues.length) {
        sidePanel.append(h('div', { class: 'notice notice-ok' }, 'All checks pass ✓'));
        return;
      }
      for (const issue of issues) {
        const cls = issue.severity === 'block' ? 'qc-block' : issue.severity === 'warn' ? 'qc-warn' : 'qc-info';
        sidePanel.append(
          h('div', {
            class: `qc-item ${cls}`,
            onClick: () => {
              map?.setHighlight(new Set(issue.seats));
              if (issue.seats.length) {
                selectedSeat = issue.seats[0];
              }
            },
          },
            h('h4', {}, `${issue.severity === 'block' ? '🔴 ' : issue.severity === 'warn' ? '🟡 ' : 'ℹ️ '}${issue.title}`),
            h('p', {}, issue.detail),
          ),
        );
      }
      return;
    }

    // seat tab — manual assignment
    const state = store.state!;
    if (!selectedSeat || !state.seats[selectedSeat]) {
      sidePanel.append(h('div', { class: 'card' }, h('p', { class: 'lead' }, 'Click a seat on the map to see who sits there, move them, or place someone.')));
      return;
    }
    const seat = state.seats[selectedSeat];
    const occupant = seatByAssignment(state)[selectedSeat];
    const buyer = occupant ? state.buyers[occupant.ticket_code] : undefined;

    const card = h('div', { class: 'card' },
      h('h3', {}, seat.seat_label),
      h('p', { class: 'lead' }, `${seat.category} · row ${seat.row_name} · ${seat.status}`),
    );

    if (occupant && buyer) {
      const locked = occupant.status !== 'assigned';
      card.append(
        h('div', { class: `notice ${locked ? 'notice-info' : 'notice-ok'}` },
          h('strong', {}, buyer.name || buyer.ticket_code), h('br'),
          `Booking ${buyer.booking_code} · ${buyer.category}`, h('br'),
          `Status: ${occupant.status}${locked ? ' (locked)' : ''}`,
        ),
        h('div', { class: 'btn-row' },
          h('button', {
            class: 'btn',
            onClick: () => {
              const sameBooking = Object.values(state.assignments)
                .filter((a) => state.buyers[a.ticket_code]?.booking_code === buyer.booking_code)
                .map((a) => a.seat_label);
              map?.setHighlight(new Set(sameBooking));
            },
          }, 'Show whole group'),
          locked
            ? h('button', {
                class: 'btn',
                onClick: async () => {
                  const ok = await confirmDialog('Unlock this seat?', 'It goes back to "assigned" so you can change it.', 'Unlock');
                  if (ok) await store.dispatch({ type: 'UNLOCK', ticket_codes: [occupant.ticket_code], reason: 'manual unlock' });
                },
              }, 'Unlock')
            : h('button', {
                class: 'btn btn-danger',
                onClick: async () => {
                  await store.dispatch({ type: 'UNASSIGN', ticket_code: occupant.ticket_code });
                  toast(`${seat.seat_label} is now empty`, 'ok');
                },
              }, 'Remove from this seat'),
        ),
      );
    } else if (seat.status === 'blocked' || seat.status === 'damaged') {
      card.append(h('div', { class: 'notice notice-warn' }, `This seat is ${seat.status} and cannot be assigned. Change its status in the Seat Map step if that's wrong.`));
    } else {
      // empty seat -> search for an unassigned buyer
      const search = h('input', { type: 'text', placeholder: 'Search name, booking or ticket code…' });
      const results = h('div', {});
      const renderResults = () => {
        results.innerHTML = '';
        const q = (search as HTMLInputElement).value.toLowerCase();
        const candidates = Object.values(state.buyers)
          .filter((b) => b.assignable && !state.assignments[b.ticket_code] && b.category === seat.category)
          .filter((b) => !q || [b.name, b.booking_code, b.ticket_code, b.email].some((v) => v?.toLowerCase().includes(q)))
          .slice(0, 12);
        if (!candidates.length) {
          results.append(h('p', { class: 'muted', style: 'font-size:12.5px' },
            `No waiting ${seat.category} buyers${q ? ' match this search' : ''}.`));
          return;
        }
        for (const b of candidates) {
          results.append(
            h('div', { class: 'qc-item', onClick: async () => {
              await store.dispatch({ type: 'ASSIGN', ticket_code: b.ticket_code, seat_label: seat.seat_label });
              toast(`${b.name || b.ticket_code} → ${seat.seat_label}`, 'ok');
            } },
              h('h4', {}, b.name || b.ticket_code),
              h('p', {}, `Booking ${b.booking_code} · ${b.ticket_code}`),
            ),
          );
        }
      };
      search.addEventListener('input', renderResults);
      renderResults();
      card.append(
        h('p', { style: 'font-weight:600;font-size:13px;margin:10px 0 6px' }, 'Place a buyer here'),
        search,
        h('div', { style: 'margin-top:8px' }, results),
      );
    }
    sidePanel.append(card);
  }

  render();
  return {
    el,
    update: () => {
      const state = store.state;
      const hasStructure = map !== null;
      const hasAssignments = !!state && Object.keys(state.assignments).length > 0;
      if (hasStructure && hasAssignments) {
        // refresh in place — keeps the admin's zoom/pan position on the map
        renderHeader();
        renderSide(runQc(state!));
        map!.update();
      } else {
        render();
      }
    },
  };
}
