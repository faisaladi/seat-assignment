// StoragePort — the seam between the app and persistence.
// Today: IndexedDB via Dexie (dexie.ts). Later: a backend implementation that
// pushes/pulls the same MutationEnvelopes for multi-admin collaboration.
// Nothing above this interface may import Dexie directly.

import type { MutationEnvelope } from '../core/mutations';

export interface EventMeta {
  id: string;
  name: string;
  updated_at: string;
}

export interface StoragePort {
  listEvents(): Promise<EventMeta[]>;
  loadMutations(eventId: string): Promise<MutationEnvelope[]>;
  appendMutations(envelopes: MutationEnvelope[]): Promise<void>;
  /** Undo support (local-first only; the backend version will append inverse mutations instead). */
  deleteMutation(eventId: string, envelopeId: string): Promise<void>;
  deleteEvent(eventId: string): Promise<void>;
}
