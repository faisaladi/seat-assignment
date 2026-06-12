// Step 6 — Export: download the Retool upload file (approved seats only,
// zero blocking issues), then mark the tickets as uploaded.

import { buildErrorReport, buildFullAssignment, buildRetoolUpload, checkRetoolExport } from '../core/export';
import type { Store } from '../store/store';
import { confirmDialog, downloadFile, emptyState, h, toast } from './components';

export function viewExport(store: Store): { el: HTMLElement; update: () => void } {
  const el = h('div', {});

  function render(): void {
    el.innerHTML = '';
    const state = store.state;
    if (!state) return;

    if (Object.keys(state.assignments).length === 0) {
      el.append(emptyState('📤', 'Nothing to export yet', [
        'Assign seats (step 4) and approve them (step 5) first. Only approved seats go into the upload file.',
      ]));
      return;
    }

    const check = checkRetoolExport(state);
    const notesInput = h('textarea', { rows: '2' });
    notesInput.value = state.info.notes_template;
    const formatSel = h('select', {},
      h('option', { value: 'csv' }, 'CSV (comma separated)'),
      h('option', { value: 'tsv' }, 'TSV (tab separated)'),
    );

    let lastExported: string[] = [];
    const markBox = h('div', {});

    el.append(
      h('div', { class: 'card' },
        h('h3', {}, 'Upload file for Retool'),
        h('p', { class: 'lead' },
          `Contains one row per approved seat: event_uid, invoice_id, booking_code, ticket_id, seat_label, notes.`),
        ...check.problems.map((p) => h('div', { class: 'notice notice-error' }, p)),
        check.ok
          ? h('div', { class: 'notice notice-ok' },
              `Ready: ${check.approvedCount} approved seat(s) will be exported.`,
              check.notApprovedCount > 0 ? ` (${check.notApprovedCount} assigned-but-not-approved seat(s) are NOT included — approve them in step 5 if they should be.)` : '')
          : null,
        h('div', { class: 'row2' },
          h('label', { class: 'field' }, h('span', {}, 'Note column (same text on every row)'), notesInput),
          h('label', { class: 'field' }, h('span', {}, 'File format'), formatSel),
        ),
        h('div', { class: 'btn-row' },
          h('button', {
            class: 'btn btn-primary',
            disabled: !check.ok,
            onClick: () => {
              const file = buildRetoolUpload(state, notesInput.value.trim(), formatSel.value as 'tsv' | 'csv');
              downloadFile(file.filename, file.content, file.mime);
              lastExported = file.ticketCodes;
              toast(`Downloaded ${file.filename}`, 'ok');
              markBox.innerHTML = '';
              markBox.append(
                h('div', { class: 'notice notice-info', style: 'margin-top:14px' },
                  h('strong', {}, 'After you upload the file to Retool: '),
                  'come back and press the button below so the app knows these seats are final.',
                  h('div', { class: 'btn-row' },
                    h('button', {
                      class: 'btn btn-green',
                      onClick: async () => {
                        const ok = await confirmDialog(
                          'Mark as uploaded?',
                          `${lastExported.length} seat(s) will be marked as uploaded to Retool. Only do this if the Retool upload succeeded.`,
                          'Yes, the upload succeeded',
                        );
                        if (ok) {
                          await store.dispatch({ type: 'MARK_UPLOADED', ticket_codes: lastExported });
                          toast('Marked as uploaded ✓', 'ok');
                          render();
                        }
                      },
                    }, `✓ Mark ${lastExported.length} seat(s) as uploaded`),
                    h('button', { class: 'btn', onClick: () => { markBox.innerHTML = ''; } }, 'The upload failed — skip'),
                  ),
                ),
              );
            },
          }, check.ok ? `⬇ Download upload file (${check.approvedCount} seats)` : 'Download not available yet'),
        ),
        markBox,
      ),
    );

    // other exports
    const errorReport = buildErrorReport(state);
    el.append(
      h('div', { class: 'card' },
        h('h3', {}, 'Other downloads'),
        h('div', { class: 'btn-row' },
          h('button', {
            class: 'btn',
            onClick: () => {
              const f = buildFullAssignment(state);
              downloadFile(f.filename, f.content, f.mime);
            },
          }, '⬇ Full seat list (all seats, with who sits where)'),
          errorReport
            ? h('button', {
                class: 'btn',
                onClick: () => downloadFile(errorReport.filename, errorReport.content, errorReport.mime),
              }, '⬇ Could-not-fit report (from the last run)')
            : null,
        ),
      ),
    );

    // status overview
    const all = Object.values(state.assignments);
    el.append(
      h('div', { class: 'card' },
        h('h3', {}, 'Where things stand'),
        h('div', { class: 'stat-grid' },
          stat(String(all.filter((a) => a.status === 'assigned').length), 'assigned (not approved)'),
          stat(String(all.filter((a) => a.status === 'approved').length), 'approved (ready to export)'),
          stat(String(all.filter((a) => a.status === 'uploaded').length), 'uploaded to Retool'),
          stat(String(Object.values(state.buyers).filter((b) => b.assignable && !state.assignments[b.ticket_code]).length), 'still waiting for a seat'),
        ),
        h('p', { class: 'muted', style: 'font-size:12.5px' },
          'New sales or refunds? Import the fresh Retool file in step 3 and run step 4 again — uploaded and approved seats are never touched.'),
      ),
    );
  }

  function stat(num: string, label: string): HTMLElement {
    return h('div', { class: 'stat' }, h('div', { class: 'stat-num' }, num), h('div', { class: 'stat-label' }, label));
  }

  render();
  return { el, update: render };
}
