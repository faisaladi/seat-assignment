// Step 2 — Set up the venue: paste the seat grid from Google Sheets,
// preview it, confirm, then fine-tune seats on the visual map.
// Areas can be painted with a category after import: Select seats → drag a box
// → set category/status for the whole selection in one go.

import { buildSeatsFromGrid, parseGridText, type GridParseResult } from '../core/grid-import';
import { normalizeCategory, seatByAssignment, type Seat, type SeatStatus } from '../core/types';
import type { Store } from '../store/store';
import { confirmDialog, h, modal, readFileAsText, toast } from './components';
import { createSeatMap } from './map-canvas';

export function viewSeatMap(store: Store): { el: HTMLElement; update: () => void } {
  const el = h('div', { style: 'height:100%;display:flex;flex-direction:column' });
  let map: ReturnType<typeof createSeatMap> | null = null;
  let sidePanel: HTMLElement | null = null;
  let headerBox: HTMLElement | null = null;
  let selection = new Set<string>();
  let mapMode: 'pan' | 'select' = 'pan';
  let colorMode: 'category' | 'status' = 'category';

  function render(): void {
    el.innerHTML = '';
    map = null;
    selection = new Set();
    const state = store.state;
    if (!state) return;

    if (state.seatOrder.length === 0) {
      el.append(renderImportCard(false));
      return;
    }

    headerBox = h('div', {});
    sidePanel = h('div', { class: 'split-side' });
    map = createSeatMap(() => store.state, {
      colorBy: colorMode,
      onSelect: (label) => {
        selection = new Set();
        map?.setHighlight(selection);
        renderSeatPanel(label);
      },
      onBoxSelect: (labels) => {
        selection = new Set(labels);
        map?.setHighlight(selection);
        renderSeatPanel(null);
      },
    });
    map.setMode(mapMode);

    renderHeader();
    renderSeatPanel(null);

    const body = h('div', { class: 'split', style: 'flex:1;min-height:0' },
      h('div', { class: 'split-main' }, map.el),
      sidePanel,
    );
    el.append(headerBox, body);
    requestAnimationFrame(() => map?.update());
  }

  function renderHeader(): void {
    if (!headerBox) return;
    headerBox.innerHTML = '';
    const state = store.state!;
    const counts: Record<string, number> = {};
    for (const l of state.seatOrder) {
      const c = state.seats[l].category || '(no category)';
      counts[c] = (counts[c] || 0) + 1;
    }
    const missing = Object.values(state.seats).filter((s) => !s.category).length;

    headerBox.append(h(
      'div',
      { class: 'card', style: 'margin-bottom:12px' },
      h('div', { style: 'display:flex;align-items:center;gap:14px;flex-wrap:wrap' },
        h('strong', {}, `${state.seatOrder.length} seats`),
        ...Object.entries(counts).map(([c, n]) =>
          h('span', { class: c === '(no category)' ? 'pill pill-amber' : 'pill pill-blue' }, `${c}: ${n}`)),
        missing > 0
          ? null
          : h('span', { class: 'pill pill-green' }, '✓ Ready for assignment'),
        h('span', { style: 'flex:1' }),
        h('div', { class: 'btn-row', style: 'gap:0' },
          h('button', {
            class: `btn ${mapMode === 'pan' ? 'btn-primary' : ''}`,
            style: 'border-radius:8px 0 0 8px',
            onClick: () => { mapMode = 'pan'; map?.setMode('pan'); renderHeader(); },
          }, '✋ Move'),
          h('button', {
            class: `btn ${mapMode === 'select' ? 'btn-primary' : ''}`,
            style: 'border-radius:0 8px 8px 0',
            onClick: () => { mapMode = 'select'; map?.setMode('select'); renderHeader(); },
          }, '⬚ Select seats'),
        ),
        h('button', {
          class: 'btn',
          onClick: () => {
            colorMode = colorMode === 'category' ? 'status' : 'category';
            map?.setColorBy(colorMode);
            renderHeader();
          },
        }, colorMode === 'category' ? 'Colors: category' : 'Colors: status'),
        h('button', { class: 'btn', onClick: () => openAddBlock() }, '+ Add another block'),
        h('button', {
          class: 'btn btn-danger',
          onClick: async () => {
            const hasAssignments = Object.keys(state.assignments).length > 0;
            const ok = await confirmDialog(
              'Replace the whole seat map?',
              hasAssignments
                ? 'Careful: seats are already assigned. Replacing the map will leave those assignments pointing at seats that may no longer exist (Review will flag them).'
                : 'The current map will be replaced by a new paste.',
              'Replace map',
            );
            if (ok) el.replaceChildren(renderImportCard(true));
          },
        }, 'Replace map'),
      ),
      h('p', { class: 'lead', style: 'margin:8px 0 0' },
        mapMode === 'select'
          ? 'Drag a box around seats to select them, then set their category or status in the side panel. Scroll to zoom.'
          : 'Click a seat to edit it (category, status, priority). Drag to move around, scroll to zoom.'),
    ));
  }

  function renderSeatPanel(label: string | null): void {
    if (!sidePanel) return;
    sidePanel.innerHTML = '';
    const state = store.state!;

    if (selection.size > 0) {
      renderBulkPanel();
      return;
    }

    if (!label || !state.seats[label]) {
      sidePanel.append(
        h('div', { class: 'card' },
          h('h3', {}, 'Seat details'),
          h('p', { class: 'lead' }, 'Click a seat on the map to edit it, or press “⬚ Select seats” and drag a box to edit a whole area at once.'),
          h('div', { class: 'notice notice-info' },
            'Tips: mark broken or production seats as “Blocked” so they are never assigned. “Restricted view” seats are used last.'),
        ),
      );
      return;
    }
    const seat = state.seats[label];
    const assignment = seatByAssignment(state)[label];
    const buyer = assignment ? state.buyers[assignment.ticket_code] : undefined;

    const catInput = h('input', { type: 'text', value: seat.category });
    const prioInput = h('input', { type: 'text', value: String(seat.priority) });
    const statusSel = h('select', {},
      ...(['available', 'blocked', 'restricted', 'held', 'damaged'] as SeatStatus[]).map((s) =>
        h('option', { value: s, selected: seat.status === s ? '' : null },
          { available: 'Available', blocked: 'Blocked (never assign)', restricted: 'Restricted view (assign last)', held: 'Held (manual only)', damaged: 'Damaged (never assign)' }[s]!),
      ),
    );
    const notesInput = h('input', { type: 'text', value: seat.notes ?? '', placeholder: 'e.g. pillar, production hold' });

    sidePanel.append(
      h('div', { class: 'card' },
        h('h3', {}, seat.display_label ?? seat.seat_label),
        h('p', { class: 'lead' }, `Row ${seat.row_name}${seat.display_label && seat.display_label !== seat.seat_label ? ` · key ${seat.seat_label}` : ''}`),
        buyer
          ? h('div', { class: 'notice notice-info' }, `Assigned to ${buyer.name || buyer.ticket_code} (booking ${buyer.booking_code}) — ${assignment!.status}`)
          : null,
        h('label', { class: 'field' }, h('span', {}, 'Category'), catInput),
        h('label', { class: 'field' }, h('span', {}, 'Priority (1 = best seat, filled first)'), prioInput),
        h('label', { class: 'field' }, h('span', {}, 'Status'), statusSel),
        h('label', { class: 'field' }, h('span', {}, 'Note'), notesInput),
        h('div', { class: 'btn-row' },
          h('button', {
            class: 'btn btn-primary',
            onClick: async () => {
              const priority = parseInt(prioInput.value, 10);
              if (Number.isNaN(priority)) {
                toast('Priority must be a number', 'error');
                return;
              }
              await store.dispatch({
                type: 'SEAT_UPDATE',
                seat_label: label,
                patch: {
                  category: normalizeCategory(catInput.value),
                  priority,
                  status: statusSel.value as SeatStatus,
                  notes: notesInput.value.trim() || undefined,
                },
              });
              toast(`Seat ${seat.display_label ?? label} updated`, 'ok');
            },
          }, 'Save seat'),
        ),
      ),
    );
  }

  function renderBulkPanel(): void {
    if (!sidePanel) return;
    sidePanel.innerHTML = '';
    const state = store.state!;
    const labels = [...selection].filter((l) => state.seats[l]);

    const catCounts: Record<string, number> = {};
    for (const l of labels) {
      const c = state.seats[l].category || 'no category yet';
      catCounts[c] = (catCounts[c] || 0) + 1;
    }

    const catInput = h('input', { type: 'text', placeholder: 'e.g. GOLD — leave blank to keep' });
    const statusSel = h('select', {},
      h('option', { value: '' }, '(keep current status)'),
      ...(['available', 'blocked', 'restricted', 'held', 'damaged'] as SeatStatus[]).map((s) =>
        h('option', { value: s },
          { available: 'Available', blocked: 'Blocked (never assign)', restricted: 'Restricted view (assign last)', held: 'Held (manual only)', damaged: 'Damaged (never assign)' }[s]!),
      ),
    );
    const prioInput = h('input', { type: 'text', placeholder: 'leave blank to keep' });

    sidePanel.append(
      h('div', { class: 'card' },
        h('h3', {}, `${labels.length} seats selected`),
        h('p', { class: 'lead' },
          Object.entries(catCounts).map(([c, n]) => `${c}: ${n}`).join(' · ')),
        h('label', { class: 'field' }, h('span', {}, 'Set category'), catInput),
        h('label', { class: 'field' }, h('span', {}, 'Set status'), statusSel),
        h('label', { class: 'field' }, h('span', {}, 'Set priority (1 = best seat)'), prioInput),
        h('div', { class: 'btn-row' },
          h('button', {
            class: 'btn btn-primary',
            onClick: async () => {
              const patch: Partial<Seat> = {};
              if (catInput.value.trim()) patch.category = normalizeCategory(catInput.value);
              if (statusSel.value) patch.status = statusSel.value as SeatStatus;
              if (prioInput.value.trim()) {
                const p = parseInt(prioInput.value, 10);
                if (Number.isNaN(p)) {
                  toast('Priority must be a number', 'error');
                  return;
                }
                patch.priority = p;
              }
              if (Object.keys(patch).length === 0) {
                toast('Type a category, pick a status, or set a priority first', 'error');
                return;
              }
              await store.dispatch({ type: 'SEATS_BULK_UPDATE', seat_labels: labels, patch });
              toast(`${labels.length} seats updated ✓`, 'ok');
              renderSeatPanel(null);
            },
          }, `Apply to ${labels.length} seats`),
          h('button', {
            class: 'btn',
            onClick: () => {
              selection = new Set();
              map?.setHighlight(selection);
              renderSeatPanel(null);
            },
          }, 'Clear selection'),
        ),
        h('div', { class: 'notice notice-info', style: 'margin-top:10px' },
          'Tip: drag another box to change the selection. Categories must match the buyers’ ticket categories (e.g. GOLD) for automatic assignment to work.'),
      ),
    );
  }

  function renderImportCard(replace: boolean): HTMLElement {
    const pasteArea = h('textarea', { class: 'paste-area', placeholder: 'Paste your seat cells here…' });
    const modeSel = h('select', {},
      h('option', { value: 'refs' }, 'Cells have seat references (e.g. A-13 or T1-93)'),
      h('option', { value: 'labels' }, 'Cells have full labels (e.g. GOLD-A1-45)'),
      h('option', { value: 'numbers' }, 'Cells have seat numbers only (e.g. 45)'),
    );
    const catInput = h('input', { type: 'text', placeholder: 'e.g. GOLD' });
    const rowPrefixInput = h('input', { type: 'text', value: 'A', placeholder: 'A' });
    const catLabel = h('span', {}, 'Ticket category for this block *');
    const catSmall = h('small', {}, 'All pasted seats get this category. Paste each category as its own block.');
    const categoryField = h('label', { class: 'field' }, catLabel, catInput, catSmall);
    const rowPrefixField = h('label', { class: 'field' },
      h('span', {}, 'Row name prefix'), rowPrefixInput,
      h('small', {}, 'Rows are named from the top: A1, A2, A3…'));
    const extraFields = h('div', { class: 'row2' }, categoryField, rowPrefixField);
    const skipCheck = h('input', { type: 'checkbox', checked: true });
    const skipField = h('label', { class: 'field', style: 'display:flex;align-items:center;gap:8px' },
      skipCheck, h('span', { style: 'margin:0' }, 'Skip cells that aren’t seat references (gate labels like “PINTU 10”, bare numbers) — they become gaps'));
    const updateFields = () => {
      const m = modeSel.value;
      categoryField.style.display = m === 'numbers' || m === 'refs' ? '' : 'none';
      rowPrefixField.style.display = m === 'numbers' ? '' : 'none';
      skipField.style.display = m === 'refs' ? 'flex' : 'none';
      if (m === 'refs') {
        catLabel.textContent = 'Ticket category for this block (optional)';
        catSmall.textContent = 'Leave blank to paste the whole venue at once — after importing, select areas on the map and set each category there.';
      } else {
        catLabel.textContent = 'Ticket category for this block *';
        catSmall.textContent = 'All pasted seats get this category. Paste each category as its own block.';
      }
    };
    modeSel.addEventListener('change', updateFields);
    updateFields();
    const frontCheck = h('input', { type: 'checkbox', checked: true });
    const previewBox = h('div', {});

    let parsed: GridParseResult | null = null;

    const doPreview = () => {
      previewBox.innerHTML = '';
      const text = pasteArea.value;
      if (!text.trim()) {
        toast('Paste your seat grid first', 'error');
        return;
      }
      const cells = parseGridText(text);
      parsed = buildSeatsFromGrid(cells, {
        mode: modeSel.value as 'labels' | 'numbers' | 'refs',
        category: catInput.value,
        rowPrefix: rowPrefixInput.value || 'R',
        skipNonRefs: skipCheck.checked,
        firstRowIsFront: frontCheck.checked,
        gridYOffset: replace ? 0 : maxGridY() + 2,
        existingLabels: replace ? undefined : new Set(store.state!.seatOrder),
      });

      for (const p of parsed.problems) {
        previewBox.append(h('div', { class: `notice notice-${p.level === 'error' ? 'error' : 'warn'}` }, p.message));
      }
      if (parsed.seats.length) {
        const s = parsed.stats;
        previewBox.append(
          h('div', { class: 'stat-grid' },
            stat(String(s.seats), 'seats found'),
            stat(String(s.rows), 'rows'),
            stat(String(s.segments), 'seat groups (split by aisles)'),
            ...Object.entries(s.categories).map(([c, n]) => stat(String(n), c)),
          ),
          h('div', { class: 'grid-preview' }, miniPreview(cells)),
          h('p', { class: 'muted', style: 'font-size:12px' },
            'Check this matches your venue: ▢ = seat, space = aisle/gap. Row lengths: ' + s.rowLengths.join(', ')),
        );
        const hasErrors = parsed.problems.some((p) => p.level === 'error');
        previewBox.append(
          h('div', { class: 'btn-row' },
            h('button', {
              class: 'btn btn-green',
              disabled: hasErrors,
              onClick: async () => {
                if (!parsed) return;
                await store.dispatch({ type: 'SEATMAP_IMPORT', seats: parsed.seats, replace });
                toast(`${parsed.seats.length} seats imported`, 'ok');
                render();
              },
            }, hasErrors ? 'Fix the errors above first' : `✓ Looks right — import ${parsed.seats.length} seats`),
          ),
        );
      }
    };

    const fileInput = h('input', { type: 'file', accept: '.csv,.tsv,.txt', style: 'display:none' });
    fileInput.addEventListener('change', async () => {
      const f = (fileInput as HTMLInputElement).files?.[0];
      if (f) {
        pasteArea.value = await readFileAsText(f);
        toast(`Loaded ${f.name}`, 'ok');
      }
    });

    return h('div', {},
      h('div', { class: 'card' },
        h('h3', {}, replace ? 'Replace the seat map' : 'Set up your venue'),
        h('p', { class: 'lead' }, 'Copy your seating layout from Google Sheets and paste it below. The app reads it exactly like the sheet looks.'),
        h('div', { class: 'notice notice-info' },
          h('strong', {}, 'How to copy from Google Sheets: '),
          '1) Open the sheet with your seat layout. 2) Select all the seat cells (one cell = one seat, leave aisles/walkways as empty cells, one sheet row = one venue row). 3) Copy (Ctrl/Cmd+C) and paste in the box below.'),
        h('label', { class: 'field' }, h('span', {}, 'What is written in each cell?'), modeSel),
        extraFields,
        skipField,
        h('label', { class: 'field', style: 'display:flex;align-items:center;gap:8px' },
          frontCheck, h('span', { style: 'margin:0' }, 'The first pasted row is closest to the stage (best seats)')),
        h('label', { class: 'field' }, h('span', {}, 'Your seat grid *'), pasteArea),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-primary', onClick: doPreview }, 'Preview'),
          h('button', { class: 'btn', onClick: () => fileInput.click() }, '…or upload a .csv file'),
          fileInput,
          replace ? h('button', { class: 'btn', onClick: render }, 'Cancel') : null,
        ),
      ),
      previewBox,
    );
  }

  function openAddBlock(): void {
    const content = renderImportCard(false);
    const m = modal('Add another seat block', content, [
      h('button', { class: 'btn', onClick: () => m.close() }, 'Close'),
    ]);
  }

  function maxGridY(): number {
    const state = store.state!;
    let max = -2;
    for (const l of state.seatOrder) max = Math.max(max, state.seats[l].grid_y);
    return max;
  }

  function stat(num: string, label: string): HTMLElement {
    return h('div', { class: 'stat' }, h('div', { class: 'stat-num' }, num), h('div', { class: 'stat-label' }, label));
  }

  function miniPreview(cells: string[][]): string {
    return cells
      .slice(0, 40)
      .map((row) => row.map((c) => (c.trim() ? '▢' : ' ')).join(''))
      .join('\n');
  }

  render();
  return {
    el,
    update: () => {
      // refresh header + map in place — keeps zoom/pan and selection
      if (map && store.state && store.state.seatOrder.length > 0) {
        renderHeader();
        map.update();
      } else {
        render();
      }
    },
  };
}
