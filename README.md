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
  Shift-click (or toggle **Chord**) to stack notes at the same time. A new note is selected (a stacked chord stays
  selected together), so you can change its value, move it or delete it straight away. Drag a note at the cursor to another
  string or fret to move it there (you hear each new pitch); if it's part of a selection, the selected notes move
  with it by the same strings and frets, so a chord shape slides up the neck intact. Clicking a note selects it.
- **Timeline**: click to move the cursor (time + string), click notes to select and hear them (the cursor moves to the note, so the fretboard or keyboard shows it; Shift for multi), and drag across
  empty space to box-select. Dragging selected notes sideways moves them in time; dragging up or down transposes them
  (piano: one row per semitone; guitar/bass: notes stay on their strings and the fret changes, about 10 px per
  semitone; drums: moves hits to another kit piece). The selection moves as a group and stops at the instrument's
  range, so chords keep their shape. The grabbed note sounds at each new pitch.
- **Rows**: the song is laid out in rows of 4 bars, stacked like a page and scrolled vertically; click anywhere in
  any row to put the cursor there. `PgUp`/`PgDn` move the cursor a row, and the view follows the cursor (and the
  playhead during playback). The toolbar's −/+ sets bars per row (1, 2, 4 or 8); picking a short note value on a
  narrow window drops to fewer bars per row so the grid stays clickable. Notes that run past the end of a row
  continue at the start of the next (drawn dashed).
- **Note values**: `W` `H` `Q` `E` `S`, `T` toggles triplet. Changing the value resizes any selected notes, including
  the one you just entered; if they end at the cursor, the cursor moves with them. Press `Esc` first to change the
  value for the next note only.
- **Typing frets**: `0`–`9` enters a fret on the cursor string; two digits in quick succession make fret 10+.
- `←/→` step the cursor and select (and hear) the note or chord that starts there · `↑/↓` cursor string · `Shift+↑/↓` fret ±1 · `Alt+←/→` move notes in time ·
  `Alt+↑/↓` move notes to the adjacent string at the same pitch · `Space` play · `Del` delete (deleting one note selects the one before it) ·
  `Ctrl+Z / Ctrl+Shift+Z` undo/redo · `Ctrl+A/C/X/V` select all, copy, cut, paste at the cursor.
- **Palm muting**: `P` (or **P.M.** in the toolbar) palm mutes the selected guitar or bass notes, or unmutes them if
  they all are already. The timeline marks them as in tab: "P.M. - - -|" above the strings, one span per run of
  muted notes. Palm-muted notes are damped: they ring for at most 0.2 s and play a little softer. With a SoundFont,
  clean and acoustic guitars also switch to General MIDI's muted guitar sound (program 28) for those notes, so
  MIDI export gives them a channel of their own. GM has no distorted or bass palm-mute sound, so overdriven,
  distorted and bass tracks keep their own tone and are only damped. The built-in synth damps the string itself.
  Palm muting is kept by copy/paste between guitar and bass tracks and in project files.
- **Copying between instruments**: copied notes keep their real pitch, so you can paste them into a different kind
  of track. Into the same instrument with the same tuning, the fingering is kept as-is. Into piano, each note goes on
  its key. Between guitar and bass (or two guitars tuned differently), the strings are lined up: a part on a
  guitar's low B string goes on a 5-string bass's low B string with the same frets (an octave down, as bass parts
  sound), E and A string parts go on the bass's E and A, and bass to guitar goes an octave up. Notes on strings
  with no counterpart (a guitar's top strings on a bass) are fingered by pitch in the same octave. Otherwise
  (from piano, or when no strings line up), strings and frets are chosen for you: chord shapes stay compact, and a passage is
  kept in one hand position where possible (e.g. piano C–Am–F–G voicings become the usual open and barre chords).
  Notes outside the instrument's range move by octaves, chords with more notes than strings lose inner voices, and
  the status bar says when either happened. Drum hits and pitched notes don't paste into each other.
- **Tracks**: add guitar, bass, piano or drum tracks from the tab bar. Bass tracks are 4-string (E A D G), 24 frets, and
  work exactly like guitar tracks: fretboard, typed frets, moving notes between strings at the same pitch. Double-click a tab to rename it; **M** mutes it during
  playback and **S** solos it: while any track is soloed, only soloed tracks play (Alt-click **S** to solo just
  that track; mute still wins). Both are just for you, not saved in the song, and take effect immediately, even
  mid-playback; **×** deletes it along with its notes (undoable).
- **Tunings**: the tuning button on an active guitar or bass tab (e.g. **E Std**) opens presets — 6-string
  (Standard, E♭/D/C/B Standard, Drop D/C/B, DADGAD, Open G, Open D), 7-string (Standard B, Drop A, A Standard) and
  bass (Standard, Drop D, D Standard, 5-string B) — or set each string a semitone at a time and add or remove a low
  string (4–8 strings) for a custom tuning. Retuning keeps every note's string and fret, like retuning a real
  instrument, so the tab stays the same and the pitches follow. Notes on a removed string move to another string at
  the same pitch where possible; the status bar reports any that couldn't.
- **Other instruments**: **+ Instrument…** adds a track for any melodic instrument (kalimba, strings, flute,
  synth pads, …). With a SoundFont loaded it lists the font's own presets, including variations in other banks
  (e.g. Ukulele, 12-String Guitar), searchable and grouped by General MIDI family; without one it lists the 128
  General MIDI instruments. Guitars and basses get a fretboard track, everything else a piano-roll track. A
  piano-roll track's instrument menu offers every instrument, and a track still named after its instrument is
  renamed when you switch. The built-in synth plays piano-roll tracks as piano, so load a SoundFont to hear the
  real instrument. The bank is saved in the song and sent as bank select (CC 0) in MIDI exports.
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
- **Projects**: **Save** (`Ctrl+S`) writes the whole song to a `.leetguitar` file, and **Open…** (`Ctrl+O`, or
  drop a file on the page) loads one. In Chromium browsers Save then keeps writing to that same file
  (`Ctrl+Shift+S` saves a copy elsewhere); in other browsers Save downloads a copy. Opening a project replaces the
  current song for everyone editing it, as one edit that `Ctrl+Z` undoes. The song is also kept in this browser
  automatically, so files are for backups, moving between machines and sharing. A project keeps everything; MIDI
  export leaves out strings and frets, tunings, track kinds and names.
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
  gm.ts           General MIDI instrument names and families
  instruments.ts  Per track kind (guitar / bass / piano / drums): default lanes, frets, instrument choices
  lanes.ts        Which lanes the timeline shows (piano roll range)
  transfer.ts     Pasting across instruments: pitch → lane/fret, guitar/bass fingering search
  tunings.ts      Tuning presets (6/7-string guitar, 4/5-string bass) and names
  project.ts      Project file format: song ↔ JSON, validation, ops that replace a document's contents
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
