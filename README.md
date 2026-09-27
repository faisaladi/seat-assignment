# Seat Assignment Engine & Canvas App

> **Project Status**: 🟢 `Production-Ready Offline-First Web App`  
> **Tech Stack**: TypeScript + Vite + Dexie (IndexedDB) + Canvas API + Vitest  
> **Architecture**: Event-sourced state reducer with pure business logic engine & `StoragePort` abstraction (19/19 Unit Tests Passing)

An offline-first, client-side web application for concert and event seat assignment. Runs entirely in the browser with local persistence, deterministic constraint satisfaction, complete undo/redo audit logs, and high-performance Canvas rendering.

## For admins: how to use it

The app walks you through 6 steps, in order, in the left sidebar:

1. **Event** — Create the event (just a name to start). Paste the Retool
   *event UID* here too — you'll need it before exporting.
2. **Seat Map** — Open your seating layout in Google Sheets, select the seat
   cells, copy, and paste into the app. One cell = one seat, empty cells =
   aisles, one sheet row = one venue row. Preview, then confirm.
   Click any seat afterwards to mark it blocked / restricted / held.
3. **Buyers** — Export the buyer list from Retool (CSV) and paste or upload it.
   The app removes duplicates, skips refunds/cancellations, and asks you which
   seat category each ticket type belongs to (remembered for next time).
4. **Assign** — Tick the categories and press Preview. People who bought
   together sit together, best seats fill first. Nothing is saved until you
   press "Use these seats".
5. **Review** — Fix any red (must-fix) problems, check warnings, place or move
   people by hand on the map, then **Approve**. Approved seats are locked —
   future runs never move them.
6. **Export** — Download the upload file (approved seats only) and upload it to
   Retool. Then mark the seats as uploaded.

**New sales wave or refunds?** Import the fresh Retool file in step 3 again and
re-run step 4. Already-uploaded and approved seats are never touched — only new
tickets get seats.

**Mistake?** The ↩ Undo button (top right) reverses the last change.

## For developers

```bash
npm install
npm run dev      # local dev server
npm run test     # engine + reducer unit tests
npm run build    # static build in dist/ (deploy anywhere, or open locally)
```

### Architecture (read this before changing code)

- **Discrete mutations** — every state change is a serializable `Mutation`
  object (`src/core/mutations.ts`) applied through one pure reducer. The
  persisted mutation log is the source of truth; reload = replay. Undo and the
  audit history are byproducts of the log.
- **`src/core/`** is pure logic (no DOM, no storage): grid importer, buyer
  importer, the 4-pass assignment engine, QC rules, exporters. All unit-tested.
- **`src/storage/`** — `StoragePort` interface with a Dexie/IndexedDB
  implementation. **The multi-user upgrade path:** implement `StoragePort`
  against a backend that syncs `MutationEnvelope`s (the `seq` field is the
  conflict-detection key), swap it in `main.ts`, and add a subscription that
  re-reduces remote envelopes. Nothing above the interface changes.
- **`src/ui/`** — vanilla TypeScript views + a canvas seat map renderer.

### Deliberately out of scope in this iteration

- Allocation groups / channel holds (seat pools per sales channel)
- Re-import diff report (synced / conflict / new / voided view)
- Multi-user sync (architecture is ready; needs the backend `StoragePort`)
- Drag-to-move seats on the map (use click → remove → place instead)
