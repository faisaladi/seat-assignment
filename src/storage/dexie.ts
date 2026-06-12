import Dexie, { type Table } from 'dexie';
import type { MutationEnvelope } from '../core/mutations';
import type { EventMeta, StoragePort } from './interface';

class SeatDb extends Dexie {
  envelopes!: Table<MutationEnvelope, string>;
  events!: Table<EventMeta, string>;

  constructor() {
    super('seat-assignment');
    this.version(1).stores({
      envelopes: '&id, event_id, [event_id+seq]',
      events: '&id, updated_at',
    });
  }
}

export class DexieStorage implements StoragePort {
  private db = new SeatDb();

  async listEvents(): Promise<EventMeta[]> {
    const events = await this.db.events.toArray();
    return events.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async loadMutations(eventId: string): Promise<MutationEnvelope[]> {
    return this.db.envelopes.where('event_id').equals(eventId).sortBy('seq');
  }

  async appendMutations(envelopes: MutationEnvelope[]): Promise<void> {
    await this.db.transaction('rw', this.db.envelopes, this.db.events, async () => {
      await this.db.envelopes.bulkPut(envelopes);
      // keep the event list cache fresh
      for (const env of envelopes) {
        const m = env.mutation;
        if (m.type === 'EVENT_CREATE') {
          await this.db.events.put({ id: env.event_id, name: m.info.name, updated_at: env.at });
        } else if (m.type === 'EVENT_SETTINGS_UPDATE' && m.patch.name) {
          await this.db.events.update(env.event_id, { name: m.patch.name, updated_at: env.at });
        } else {
          await this.db.events.update(env.event_id, { updated_at: env.at });
        }
      }
    });
  }

  async deleteMutation(eventId: string, envelopeId: string): Promise<void> {
    await this.db.envelopes.delete(envelopeId);
  }

  async deleteEvent(eventId: string): Promise<void> {
    await this.db.transaction('rw', this.db.envelopes, this.db.events, async () => {
      await this.db.envelopes.where('event_id').equals(eventId).delete();
      await this.db.events.delete(eventId);
    });
  }
}
