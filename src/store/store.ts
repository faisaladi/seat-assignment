// App store — holds the open event's state, dispatches mutations through the
// single write path: dispatch -> applyMutation (pure) -> storage.append -> notify.

import { applyMutation, describeMutation, replay, type Mutation, type MutationEnvelope } from '../core/mutations';
import type { EventState } from '../core/types';
import type { EventMeta, StoragePort } from '../storage/interface';

type Listener = () => void;

export class Store {
  state: EventState | undefined;
  eventList: EventMeta[] = [];
  private eventId: string | undefined;
  private seq = 0;
  private log: MutationEnvelope[] = [];
  private listeners = new Set<Listener>();

  constructor(private storage: StoragePort) {}

  async init(): Promise<void> {
    this.eventList = await this.storage.listEvents();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  get currentEventId(): string | undefined {
    return this.eventId;
  }

  async openEvent(id: string): Promise<void> {
    this.log = await this.storage.loadMutations(id);
    this.state = replay(this.log);
    this.eventId = id;
    this.seq = this.log.length ? this.log[this.log.length - 1].seq : 0;
    this.notify();
  }

  closeEvent(): void {
    this.eventId = undefined;
    this.state = undefined;
    this.log = [];
    this.seq = 0;
    this.notify();
  }

  async createEvent(mutation: Extract<Mutation, { type: 'EVENT_CREATE' }>): Promise<void> {
    this.eventId = mutation.info.id;
    this.log = [];
    this.seq = 0;
    this.state = undefined;
    await this.dispatch(mutation);
    this.eventList = await this.storage.listEvents();
  }

  async dispatch(mutation: Mutation): Promise<void> {
    if (!this.eventId) throw new Error('No event open');
    const env: MutationEnvelope = {
      id: crypto.randomUUID(),
      event_id: this.eventId,
      seq: ++this.seq,
      at: new Date().toISOString(),
      by: 'admin',
      mutation,
    };
    this.state = applyMutation(this.state, mutation, env);
    await this.storage.appendMutations([env]);
    this.log.push(env);
    this.notify();
  }

  /** What would be undone, or null when the log is empty / only has the create. */
  lastUndoable(): MutationEnvelope | null {
    const last = this.log[this.log.length - 1];
    if (!last || last.mutation.type === 'EVENT_CREATE') return null;
    return last;
  }

  describeLast(): string | null {
    const last = this.lastUndoable();
    return last ? describeMutation(last.mutation) : null;
  }

  async undo(): Promise<void> {
    const last = this.lastUndoable();
    if (!last || !this.eventId) return;
    await this.storage.deleteMutation(this.eventId, last.id);
    this.log.pop();
    this.state = replay(this.log);
    this.seq = this.log.length ? this.log[this.log.length - 1].seq : 0;
    this.notify();
  }

  async deleteEvent(id: string): Promise<void> {
    await this.storage.deleteEvent(id);
    if (this.eventId === id) this.closeEvent();
    this.eventList = await this.storage.listEvents();
    this.notify();
  }

  history(): MutationEnvelope[] {
    return this.log;
  }
}
