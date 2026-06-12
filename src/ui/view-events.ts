// Step 1 — Your events: pick an event to work on, or create a new one.

import { DEFAULT_ASSIGNABLE_STATUSES, type EventInfo } from '../core/types';
import type { Store } from '../store/store';
import { confirmDialog, emptyState, h, toast } from './components';

export function viewEvents(store: Store, onOpen: () => void): { el: HTMLElement; update: () => void } {
  const el = h('div', {});

  function render(): void {
    el.innerHTML = '';

    const list = h('div', {});
    if (store.eventList.length === 0) {
      list.append(
        emptyState('🎫', 'No events yet', [
          'An event is one concert or show you need to assign seats for.',
          'Create your first event below — you only need a name to start.',
        ]),
      );
    } else {
      const table = h(
        'table',
        { class: 'data' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Event'), h('th', {}, 'Last change'), h('th', {}, ''))),
      );
      const tbody = h('tbody', {});
      for (const ev of store.eventList) {
        tbody.append(
          h(
            'tr',
            {},
            h('td', {}, h('strong', {}, ev.name)),
            h('td', { class: 'muted' }, new Date(ev.updated_at).toLocaleString()),
            h(
              'td',
              { style: 'text-align:right' },
              h(
                'button',
                {
                  class: 'btn btn-primary',
                  onClick: async () => {
                    await store.openEvent(ev.id);
                    onOpen();
                  },
                },
                'Open',
              ),
              ' ',
              h(
                'button',
                {
                  class: 'btn btn-danger',
                  onClick: async () => {
                    const ok = await confirmDialog(
                      'Delete this event?',
                      `"${ev.name}" and all its seats, buyers and assignments will be removed from this computer. This cannot be undone.`,
                      'Delete event',
                    );
                    if (ok) {
                      await store.deleteEvent(ev.id);
                      toast('Event deleted', 'info');
                      render();
                    }
                  },
                },
                'Delete',
              ),
            ),
          ),
        );
      }
      table.append(tbody);
      list.append(h('div', { class: 'card' }, h('h3', {}, 'Your events'), table));
    }

    // create form
    const nameInput = h('input', { type: 'text', placeholder: 'e.g. Yovie & Nuno — Jakarta' });
    const uidInput = h('input', { type: 'text', placeholder: 'paste from Retool, e.g. dfb9cadf-…' });
    const venueInput = h('input', { type: 'text', placeholder: 'optional' });
    const dateInput = h('input', { type: 'text', placeholder: 'optional, e.g. 12 July 2026' });
    const notesInput = h('textarea', { rows: '2', placeholder: 'optional — this text goes in the "notes" column of the upload file' });
    notesInput.value = 'Wajib duduk di kursi yang telah di berikan promotor';

    const form = h(
      'div',
      { class: 'card' },
      h('h3', {}, 'Create a new event'),
      h('p', { class: 'lead' }, 'Only the name is needed to start. The Retool event UID is required later, before you export.'),
      h('div', { class: 'row2' },
        h('label', { class: 'field' }, h('span', {}, 'Event name *'), nameInput),
        h('label', { class: 'field' }, h('span', {}, 'Retool event UID'), uidInput,
          h('small', {}, 'Found in Retool. Needed for the upload file.')),
      ),
      h('div', { class: 'row2' },
        h('label', { class: 'field' }, h('span', {}, 'Venue'), venueInput),
        h('label', { class: 'field' }, h('span', {}, 'Event date'), dateInput),
      ),
      h('label', { class: 'field' }, h('span', {}, 'Note for ticket buyers (goes on the upload file)'), notesInput),
      h(
        'div',
        { class: 'btn-row' },
        h(
          'button',
          {
            class: 'btn btn-primary',
            onClick: async () => {
              const name = nameInput.value.trim();
              if (!name) {
                toast('Please enter an event name', 'error');
                return;
              }
              const info: EventInfo = {
                id: crypto.randomUUID(),
                name,
                event_uid: uidInput.value.trim(),
                venue: venueInput.value.trim(),
                event_date: dateInput.value.trim(),
                notes_template: notesInput.value.trim(),
                assignable_statuses: DEFAULT_ASSIGNABLE_STATUSES,
                category_aliases: {},
                created_at: new Date().toISOString(),
              };
              await store.createEvent({ type: 'EVENT_CREATE', info });
              toast(`Event "${name}" created`, 'ok');
              onOpen();
            },
          },
          'Create event',
        ),
      ),
    );

    el.append(list, form);

    // settings for the open event
    if (store.state) {
      const info = store.state.info;
      const sName = h('input', { type: 'text', value: info.name });
      const sUid = h('input', { type: 'text', value: info.event_uid });
      const sNotes = h('textarea', { rows: '2' });
      sNotes.value = info.notes_template;
      const sStatuses = h('input', { type: 'text', value: info.assignable_statuses.join(', ') });
      el.append(
        h(
          'div',
          { class: 'card' },
          h('h3', {}, `Settings — ${info.name} (currently open)`),
          h('div', { class: 'row2' },
            h('label', { class: 'field' }, h('span', {}, 'Event name'), sName),
            h('label', { class: 'field' }, h('span', {}, 'Retool event UID'), sUid),
          ),
          h('label', { class: 'field' }, h('span', {}, 'Note for the upload file'), sNotes),
          h('label', { class: 'field' }, h('span', {}, 'Ticket statuses that should get a seat'), sStatuses,
            h('small', {}, 'Comma-separated. Tickets whose Booking Status and Ticket Status are not in this list are skipped (refunds, cancellations).')),
          h(
            'div',
            { class: 'btn-row' },
            h(
              'button',
              {
                class: 'btn btn-primary',
                onClick: async () => {
                  await store.dispatch({
                    type: 'EVENT_SETTINGS_UPDATE',
                    patch: {
                      name: sName.value.trim() || info.name,
                      event_uid: sUid.value.trim(),
                      notes_template: sNotes.value.trim(),
                      assignable_statuses: sStatuses.value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
                    },
                  });
                  toast('Settings saved', 'ok');
                },
              },
              'Save settings',
            ),
          ),
        ),
      );
    }
  }

  render();
  return { el, update: render };
}
