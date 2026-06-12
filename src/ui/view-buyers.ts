// Step 3 — Import ticket buyers: paste or upload the Retool export.
// Validates the 5 required columns, resolves ticket names to seat categories,
// removes duplicates, and shows a clear summary before anything is saved.

import { parseBuyerFile, type BuyerParseResult } from '../core/buyer-import';
import { normalizeCategory } from '../core/types';
import type { Store } from '../store/store';
import { emptyState, h, readFileAsText, toast } from './components';

export function viewBuyers(store: Store): { el: HTMLElement; update: () => void } {
  const el = h('div', {});

  function render(): void {
    el.innerHTML = '';
    const state = store.state;
    if (!state) return;

    if (state.seatOrder.length === 0) {
      el.append(emptyState('🗺️', 'Set up the seat map first', [
        'Buyers are matched to seat categories (GOLD, DIAMOND…), so the app needs to know your seats before importing buyers.',
        'Go to step 2 — Seat Map.',
      ]));
      return;
    }

    // current buyers summary
    const buyers = Object.values(state.buyers);
    if (buyers.length) {
      const byCat: Record<string, { yes: number; no: number }> = {};
      let assigned = 0;
      for (const b of buyers) {
        byCat[b.category] ??= { yes: 0, no: 0 };
        if (b.assignable) byCat[b.category].yes++;
        else byCat[b.category].no++;
        if (state.assignments[b.ticket_code]) assigned++;
      }
      el.append(
        h('div', { class: 'card' },
          h('h3', {}, `${buyers.length} buyers imported`),
          h('div', { class: 'stat-grid' },
            stat(String(buyers.filter((b) => b.assignable).length), 'need a seat'),
            stat(String(assigned), 'already seated'),
            stat(String(buyers.filter((b) => !b.assignable).length), 'skipped (refunded / cancelled)'),
          ),
          h('table', { class: 'data' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Category'), h('th', {}, 'Need a seat'), h('th', {}, 'Skipped'), h('th', {}, 'Seats in map'))),
            h('tbody', {},
              ...Object.entries(byCat).map(([cat, n]) => {
                const seatCount = state.seatOrder.filter((l) => state.seats[l].category === cat).length;
                const short = n.yes > seatCount;
                return h('tr', {},
                  h('td', {}, h('strong', {}, cat)),
                  h('td', {}, String(n.yes)),
                  h('td', { class: 'muted' }, String(n.no)),
                  h('td', {}, `${seatCount} ${short ? '⚠ not enough!' : ''}`),
                );
              }),
            ),
          ),
          h('p', { class: 'muted', style: 'font-size:12.5px;margin-top:10px' },
            'New sales wave? Import the new file below — already-imported tickets are recognised and not duplicated.'),
        ),
      );
    }

    el.append(renderImportCard());
  }

  function renderImportCard(): HTMLElement {
    const pasteArea = h('textarea', { class: 'paste-area', placeholder: 'Paste the Retool export here (including the header row)…' });
    const channelInput = h('input', { type: 'text', placeholder: 'e.g. Public sale, BRI presale, Invitations' });
    const resultBox = h('div', {});

    const fileInput = h('input', { type: 'file', accept: '.csv,.tsv,.txt', style: 'display:none' });
    fileInput.addEventListener('change', async () => {
      const f = (fileInput as HTMLInputElement).files?.[0];
      if (f) {
        pasteArea.value = await readFileAsText(f);
        if (!channelInput.value) channelInput.value = f.name.replace(/\.[^.]+$/, '');
        toast(`Loaded ${f.name}`, 'ok');
      }
    });

    let pendingAliases: Record<string, string> = {};

    const check = () => {
      resultBox.innerHTML = '';
      const text = pasteArea.value;
      if (!text.trim()) {
        toast('Paste the buyer file first', 'error');
        return;
      }
      const channel = channelInput.value.trim() || 'import';
      const result = parseBuyerFile(text, store.state!, channel, pendingAliases);
      renderResult(result, () => check(), channel, resultBox, text);
    };

    function renderResult(result: BuyerParseResult, recheck: () => void, channel: string, box: HTMLElement, text: string): void {
      if (result.missingRequired.length) {
        box.append(h('div', { class: 'notice notice-error' },
          h('strong', {}, 'This file is missing required columns: '),
          result.missingRequired.join(', '),
          h('p', { style: 'margin:6px 0 0' }, 'The file needs these columns: Transaction ID, Booking Code, Ticket Code, Event Name, Ticket Name. Export the full list from Retool and try again.')));
        return;
      }

      // unmapped ticket names -> ask the user to map them
      if (result.unmappedTicketNames.length) {
        const state = store.state!;
        const categories = [...new Set(state.seatOrder.map((l) => state.seats[l].category).filter(Boolean))];
        const selects: Record<string, HTMLSelectElement> = {};
        box.append(
          h('div', { class: 'card', style: 'border-color:#fde68a;background:#fffbeb' },
            h('h3', {}, 'Which seats do these tickets get?'),
            h('p', { class: 'lead' }, 'These ticket names are new. Tell the app which seat category each one belongs to (saved for next time).'),
            h('table', { class: 'data' },
              h('thead', {}, h('tr', {}, h('th', {}, 'Ticket name in the file'), h('th', {}, 'Seat category'))),
              h('tbody', {},
                ...result.unmappedTicketNames.map((name) => {
                  const sel = h('select', {},
                    h('option', { value: '' }, '— choose —'),
                    ...categories.map((c) => h('option', { value: c }, c)),
                    h('option', { value: 'IGNORE' }, 'Ignore these tickets'),
                  );
                  // best guess preselect
                  const guess = categories.find((c) => normalizeCategory(name).includes(c));
                  if (guess) sel.value = guess;
                  selects[name] = sel;
                  return h('tr', {}, h('td', {}, name), h('td', {}, sel));
                }),
              ),
            ),
            h('div', { class: 'btn-row' },
              h('button', {
                class: 'btn btn-primary',
                onClick: () => {
                  for (const [name, sel] of Object.entries(selects)) {
                    if (!sel.value) {
                      toast(`Please choose a category for "${name}"`, 'error');
                      return;
                    }
                    pendingAliases[normalizeCategory(name)] = sel.value;
                  }
                  recheck();
                },
              }, 'Save and continue'),
            ),
          ),
        );
        return;
      }

      // notices
      for (const msg of result.missingOptional) {
        box.append(h('div', { class: 'notice notice-warn' }, `Optional column not found: ${msg}.`));
      }
      if (result.eventNameMismatch) {
        box.append(h('div', { class: 'notice notice-warn' },
          `Heads up: the file says the event is "${result.eventNameMismatch}" but this event is "${store.state!.info.name}". Make sure this is the right file.`));
      }
      if (result.rowErrors.length) {
        box.append(h('div', { class: 'notice notice-error' },
          h('strong', {}, `${result.rowErrors.length} row(s) skipped because of missing data: `),
          result.rowErrors.slice(0, 5).join(' · '),
          result.rowErrors.length > 5 ? ` · and ${result.rowErrors.length - 5} more` : ''));
      }
      if (result.duplicateCount) {
        box.append(h('div', { class: 'notice notice-info' }, `${result.duplicateCount} duplicate ticket(s) in the file were ignored (same Ticket Code).`));
      }

      const s = result.summary!;
      box.append(
        h('div', { class: 'card' },
          h('h3', {}, 'Ready to import'),
          h('div', { class: 'stat-grid' },
            stat(String(result.buyers.length), 'tickets'),
            stat(String(s.assignable), 'will get a seat'),
            stat(String(result.buyers.length - s.assignable), 'skipped (status)'),
          ),
          h('table', { class: 'data' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Category'), h('th', {}, 'Need a seat'), h('th', {}, 'Seats available'))),
            h('tbody', {},
              ...Object.entries(s.byCategory).map(([cat, n]) => {
                const state = store.state!;
                const occupied = new Set(Object.values(state.assignments).map((a) => a.seat_label));
                const free = state.seatOrder.filter((l) => {
                  const seat = state.seats[l];
                  return seat.category === cat && seat.status !== 'blocked' && seat.status !== 'damaged' && !occupied.has(l);
                }).length;
                return h('tr', {},
                  h('td', {}, h('strong', {}, cat)),
                  h('td', {}, String(n.assignable)),
                  h('td', {}, n.assignable > free ? `${free} ⚠ ${n.assignable - free} too many` : String(free)),
                );
              }),
            ),
          ),
          h('div', { class: 'btn-row' },
            h('button', {
              class: 'btn btn-green',
              onClick: async () => {
                await store.dispatch({ type: 'EVENT_SETTINGS_UPDATE', patch: { category_aliases: { ...store.state!.info.category_aliases, ...pendingAliases } } });
                await store.dispatch({ type: 'BUYER_IMPORT', buyers: result.buyers, source_channel: channel });
                pendingAliases = {};
                toast(`${result.buyers.length} buyers imported`, 'ok');
                render();
              },
            }, `✓ Import ${result.buyers.length} buyers`),
          ),
        ),
      );
    }

    return h('div', {},
      h('div', { class: 'card' },
        h('h3', {}, 'Import buyers from Retool'),
        h('p', { class: 'lead' }, 'Export the buyer list from Retool (CSV), then paste it here or upload the file. Nothing is saved until you confirm.'),
        h('div', { class: 'notice notice-info' },
          'The file must include: Transaction ID, Booking Code, Ticket Code, Event Name, Ticket Name. Other columns (statuses, email, seat…) are used automatically when present.'),
        h('label', { class: 'field' }, h('span', {}, 'Where are these buyers from? (a label for this file)'), channelInput,
          h('small', {}, 'Helps you tell sales waves and channels apart, e.g. “Public sale” or “BRI presale”.')),
        h('label', { class: 'field' }, h('span', {}, 'Buyer file *'), pasteArea),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-primary', onClick: check }, 'Check file'),
          h('button', { class: 'btn', onClick: () => fileInput.click() }, '…or upload a .csv file'),
          fileInput,
        ),
      ),
      resultBox,
    );
  }

  function stat(num: string, label: string): HTMLElement {
    return h('div', { class: 'stat' }, h('div', { class: 'stat-num' }, num), h('div', { class: 'stat-label' }, label));
  }

  render();
  return { el, update: render };
}
