# leet·guitar

A browser MIDI editor for composing on guitar: click notes on a fretboard, lay them out in a tab-style timeline with
whole/half/quarter/eighth/sixteenth values and triplets, play them back, and export a `.mid` file.

```sh
npm install
npm run dev     # http://localhost:5173
npm test        # model, sync and MIDI tests
npm run build
```

## Using it

- **Fretboard**: click a fret to place a note at the cursor using the current note value; the cursor then advances.
  Shift-click (or toggle **Chord**) to stack notes at the same time.
- **Timeline**: click to move the cursor (time + string), click notes to select (Shift for multi), drag to move.
- **Note values**: `W` `H` `Q` `E` `S`, `T` toggles triplet. Changing the value resizes any selected notes.
- **Typing frets**: `0`–`9` enters a fret on the cursor string; two digits in quick succession make fret 10+.
- `←/→` cursor · `↑/↓` cursor string · `Shift+↑/↓` fret ±1 · `Alt+←/→` move notes in time ·
  `Alt+↑/↓` move notes to the adjacent string at the same pitch · `Space` play · `Del` delete ·
  `Ctrl+Z / Ctrl+Shift+Z` undo/redo · `Ctrl+A/C/X/V` select all, copy, cut, paste at the cursor.
- **Export MIDI**: one channel per track, or one channel per string (the layout MIDI guitar controllers and many tab
  editors use).

Open the same URL in a second tab to see live collaboration: edits and cursors sync between tabs. Use `#doc=<name>`
in the URL for separate documents.

## Architecture

Time is measured in ticks at **480 PPQ**, which makes every triplet value an exact integer (eighth triplet = 160,
sixteenth triplet = 80).

```
src/model/      Pure document model — no DOM, no React
  crdt.ts         LWW-record CRDT: ops (put / patch / del), Lamport stamps, snapshot merge
  store.ts        DocumentStore: local transact, remote apply, per-client undo/redo, React subscription
  commands.ts     Domain edits (add/move/paste notes, …) that return ops; enforces one note per string at a time
  materialize.ts  CRDT entries → typed Song view
  durations.ts    Note values, triplets, bars/beats
src/sync/       Transport and persistence
  provider.ts     SyncProvider interface + message types
  broadcastChannel.ts  Cross-tab provider (ops, snapshot handshake, presence)
  awareness.ts    Ephemeral presence (cursor, name, colour), separate from the document
  persistence.ts  localStorage snapshots
src/editor/     Local UI state (cursor, note value, selection) and user actions / shortcuts
src/audio/      Karplus–Strong plucked-string playback (Web Audio)
src/midi/       Standard MIDI File writer
src/components/ Fretboard, Timeline, Toolbar
```

### Collaboration

Every edit goes through `DocumentStore.transact(ops)`. Ops are plain JSON, stamped with a Lamport clock and the
client's id, and every field resolves last-writer-wins, as does whether a record exists at all. So:

- Ops can be applied in any order, and snapshots merged in any order, and all clients converge (covered by tests).
- Notes have unique ids, so concurrent additions never conflict.
- Undo is per-client: it issues inverse ops as new edits, so it never rewinds a collaborator's work.
- Presence (cursors) travels on a separate channel and is never persisted.

To go networked, implement `SyncProvider` over a WebSocket relay or WebRTC using the same message shapes. Peers
exchange snapshots on join and ops afterwards; the server only needs to relay messages, plus optionally store
snapshots.
