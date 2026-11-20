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
- **Tracks**: add guitar, bass, piano or drum tracks from the tab bar. Bass tracks are 4-string (E A D G), 24 frets, and
  work exactly like guitar tracks: fretboard, typed frets, moving notes between strings at the same pitch. Double-click a tab to rename it; **M** mutes it during
  playback (just for you, not saved in the song); **×** deletes it along with its notes (undoable).
- **Piano**: a piano track swaps the fretboard for a clickable 88-key keyboard (Shift-click to stack chords), and
  the timeline becomes a piano roll that sizes itself to the range you're using (at least two octaves). Click an empty
  cell in the roll to add a note there. `↑/↓` moves the cursor a key, `Alt+↑/↓` moves selected notes a semitone and
  `Shift+↑/↓` an octave.
- **Drums**: a drum track swaps the fretboard for pads (Crash, Ride, Open hat, Hi-hat, three toms, Snare, Kick).
  Click a pad or press `1`–`9` to add a hit at the cursor (Shift-click to stack), or click an empty cell in the
  timeline to add a hit there, step-sequencer style. `Alt+↑/↓` moves hits to another kit piece.
- **Sound**: playback uses a built-in synth by default. **Load SoundFont…** picks an `.sf2`, `.sf3` or `.dls` file
  from your computer for more realistic sound; the app never downloads or hosts one. The file is kept in this
  browser (IndexedDB) for next time, you can switch back to the built-in synth from the **Sound** menu, and **×**
  removes it. This is a local setting and isn't shared with collaborators. With a SoundFont loaded, the instrument
  menu on the active track tab is audible: guitar tones (nylon, steel, clean, overdrive, distortion, …), bass tones
  (finger, pick, fretless, slap, synth, …), piano-family sounds (grand, electric grand, Rhodes, harpsichord, …) or
  drum kits
  (standard, room, jazz, brush, …). The choice is saved in the song and included in MIDI exports.
- **Export MIDI**: one channel per guitar track, or one channel per string (the layout MIDI guitar controllers and
  many tab editors use). Drum tracks always go on channel 10, the General MIDI drum channel.

Open the same URL in a second tab to see live collaboration: edits and cursors sync between tabs. Use `#doc=<name>`
in the URL for separate documents.

## Architecture

Time is measured in ticks at **480 PPQ**, which makes every triplet value an exact integer (eighth triplet = 160,
sixteenth triplet = 80).

A track is a set of lanes, each with a MIDI pitch, and a note's pitch is always `tuning[lane] + fret`. On a guitar
or bass track the lanes are strings. On a piano track there is one lane per key (C8 down to A0) and on a drum track
one per kit piece; on both, `fret` is always 0. Playback, MIDI export, and
the one-note-per-lane rule work the same way for both.

```
src/model/      Pure document model — no DOM, no React
  crdt.ts         LWW-record CRDT: ops (put / patch / del), Lamport stamps, snapshot merge
  store.ts        DocumentStore: local transact, remote apply, per-client undo/redo, React subscription
  commands.ts     Domain edits (add/move/paste notes, …) that return ops; enforces one note per string at a time
  materialize.ts  CRDT entries → typed Song view
  durations.ts    Note values, triplets, bars/beats
  drums.ts        Default kit (General MIDI drum notes) and lane names
  instruments.ts  Per track kind (guitar / bass / piano / drums): default lanes, frets, instrument choices
  lanes.ts        Which lanes the timeline shows (piano roll range)
src/sync/       Transport and persistence
  provider.ts     SyncProvider interface + message types
  broadcastChannel.ts  Cross-tab provider (ops, snapshot handshake, presence)
  awareness.ts    Ephemeral presence (cursor, name, colour), separate from the document
  persistence.ts  localStorage snapshots
src/editor/     Local UI state (cursor, note value, selection) and user actions / shortcuts
src/audio/      Playback
  player.ts       Timing: schedules notes a short window ahead into the current engine
  builtin.ts      Default engine: Karplus–Strong plucked string, additive piano (piano.ts), synthesized drums
  soundfont.ts    SoundFont engine (spessasynth_lib), lazy-loaded on first use
src/midi/       Standard MIDI File writer; channels.ts maps tracks to MIDI channels for export and playback
src/components/ Toolbar, TrackBar, Fretboard, PianoKeys, DrumPads, Timeline
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

### SoundFont playback notes

- The player hands notes to the engine about 0.2 s ahead instead of scheduling the whole song, because the
  SoundFont synth can't cancel events it has already queued. On Stop, the SoundFont output is muted for that window.
- The synth's internal clock runs a constant amount behind the `AudioContext` clock (about 200 ms in Chromium).
  `SoundFontEngine` reads the synth's clock from the messages its audio worklet sends back and corrects every
  scheduled time. This relies on an internal detail of `spessasynth_lib`, which is why the version is pinned exactly.
