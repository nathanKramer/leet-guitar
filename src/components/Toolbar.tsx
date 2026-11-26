import { useEffect, useRef, useState } from 'react';
import * as act from '../editor/actions';
import { useStore, type EditorState } from '../editor/editorStore';
import { newProject, openProject, saveProject } from '../editor/project';
import { loadSoundFontFile, removeSoundFont, setSource, sound, type SoundSource } from '../editor/sound';
import { downloadMidi, type ChannelMode } from '../midi/export';
import { setMeta } from '../model/commands';
import { isStringed } from '../model/instruments';
import { BASE_DURATIONS, DURATION_LABELS, DURATION_NAMES } from '../model/durations';
import type { Song } from '../model/types';
import { awareness, docStore, editor } from '../session';
import type { PeerState } from '../sync/awareness';

const DURATION_KEYS = {
  whole: 'W',
  half: 'H',
  quarter: 'Q',
  eighth: 'E',
  sixteenth: 'S',
  thirtysecond: '[ / ]',
} as const;

/** Text input that commits on blur / Enter, so typing doesn't create an edit per keystroke. */
function CommitInput(props: {
  value: string;
  onCommit: (v: string) => void;
  className?: string;
  type?: string;
  min?: number;
  max?: number;
  title?: string;
}) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]);
  return (
    <input
      className={props.className}
      type={props.type ?? 'text'}
      min={props.min}
      max={props.max}
      title={props.title}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== props.value && props.onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setDraft(props.value);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

export function Toolbar({ song, ed, peers }: { song: Song; ed: EditorState; peers: PeerState[] }) {
  const { meta } = song;
  return (
    <header className="toolbar">
      <div className="group">
        <span className="logo">leet·guitar</span>
        <CommitInput
          className="title"
          value={meta.title}
          title="Song title"
          onCommit={(v) => docStore.transact(setMeta({ title: v }))}
        />
        <button onClick={newProject} title="Start a new, empty project (Ctrl+Z undoes this)">
          New
        </button>
        <button onClick={() => void openProject()} title="Open a project file (Ctrl+O), or drop one on the page">
          Open…
        </button>
        <button onClick={() => void saveProject()} title="Save the project to a file (Ctrl+S; Ctrl+Shift+S to save as)">
          Save
        </button>
      </div>

      <div className="group">
        <button className="primary" onClick={act.togglePlay} title="Play / stop (Space)">
          {ed.countBeat ? `■ ${ed.countBeat}…` : ed.playing ? '■ Stop' : '▶ Play'}
        </button>
        <button
          className={ed.countIn ? 'seg active' : 'seg'}
          onClick={act.toggleCountIn}
          aria-pressed={ed.countIn}
          title="Count-in: click one bar of the time signature before playback starts"
        >
          Count-in
        </button>
        <label className="field">
          BPM
          <CommitInput
            type="number"
            min={20}
            max={400}
            value={String(meta.bpm)}
            onCommit={(v) => {
              const bpm = Math.round(Number(v));
              if (bpm >= 20 && bpm <= 400) docStore.transact(setMeta({ bpm }));
            }}
          />
        </label>
        <label className="field">
          Time
          <select
            value={meta.beatsPerBar}
            onChange={(e) => docStore.transact(setMeta({ beatsPerBar: Number(e.target.value) }))}
          >
            {Array.from({ length: 15 }, (_, i) => i + 1).map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
          /
          <select
            value={meta.beatUnit}
            onChange={(e) => docStore.transact(setMeta({ beatUnit: Number(e.target.value) }))}
          >
            {[2, 4, 8, 16].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="group" role="radiogroup" aria-label="Note value">
        {BASE_DURATIONS.map((d) => (
          <button
            key={d}
            className={ed.base === d ? 'seg active' : 'seg'}
            onClick={() => act.setDuration(d)}
            title={`${DURATION_NAMES[d]} note (${DURATION_KEYS[d]}; [ / ] for shorter / longer)`}
          >
            {DURATION_LABELS[d]}
          </button>
        ))}
        <button
          className={ed.triplet ? 'seg active triplet' : 'seg triplet'}
          onClick={act.toggleTriplet}
          title="Triplet: 3 notes in the time of 2 (T)"
        >
          ³ Triplet
        </button>
        <button
          className={ed.chordMode ? 'seg active' : 'seg'}
          onClick={() => editor.set((s) => ({ chordMode: !s.chordMode }))}
          title="Chord mode: placing a note doesn't advance the cursor (C, or hold Shift)"
        >
          Chord
        </button>
        <PalmMuteButton song={song} ed={ed} />
      </div>

      <div className="group">
        <button onClick={act.undo} disabled={!docStore.canUndo} title="Undo (Ctrl+Z)">
          ↶
        </button>
        <button onClick={act.redo} disabled={!docStore.canRedo} title="Redo (Ctrl+Shift+Z)">
          ↷
        </button>
        <button onClick={() => act.stepBarsPerRow(1)} title="Zoom out: more bars per row">
          −
        </button>
        <span className="muted bars-per-row" title="Bars per timeline row">
          {ed.barsPerRow} {ed.barsPerRow === 1 ? 'bar' : 'bars'}/row
        </span>
        <button onClick={() => act.stepBarsPerRow(-1)} title="Zoom in: fewer bars per row">
          +
        </button>
      </div>

      <div className="group">
        <select
          value={ed.midiMode}
          onChange={(e) => editor.set({ midiMode: e.target.value as ChannelMode })}
          title="MIDI channel layout"
        >
          <option value="per-track">1 channel / track</option>
          <option value="per-string">1 channel / string</option>
        </select>
        <button onClick={() => downloadMidi(song, ed.midiMode)}>Export MIDI</button>
      </div>

      <SoundControl />

      <div className="group peers" title="People editing this document (open another tab to try it)">
        {[awareness.local, ...peers].map((p) => (
          <span key={p.actor} className="avatar" style={{ background: p.color }} title={p.name}>
            {p.name.replace('Guest ', '').slice(0, 2).toUpperCase()}
          </span>
        ))}
      </div>
    </header>
  );
}

/** Palm mute toggle for the selected guitar/bass notes; lit when they're all palm muted. */
function PalmMuteButton({ song, ed }: { song: Song; ed: EditorState }) {
  const track = song.tracks[ed.trackId];
  if (!track || !isStringed(track.kind)) return null;
  const sel = ed.selection.map((id) => song.notes[id]).filter(Boolean);
  const on = sel.length > 0 && sel.every((n) => n.palmMute);
  return (
    <button
      className={on ? 'seg active' : 'seg'}
      onClick={act.togglePalmMute}
      disabled={!sel.length}
      title="Palm mute the selected notes (P)"
    >
      P.M.
    </button>
  );
}

/** Built-in synth vs a SoundFont loaded from disk (local preference, not synced). */
function SoundControl() {
  const st = useStore(sound);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div
      className="group sound"
      title="Playback sound. A SoundFont is loaded from your computer and kept in this browser only."
    >
      <label className="field">
        Sound
        <select value={st.source} disabled={st.loading} onChange={(e) => setSource(e.target.value as SoundSource)}>
          <option value="builtin">Built-in synth</option>
          {st.fontName && <option value="soundfont">{st.fontName}</option>}
        </select>
      </label>
      <button disabled={st.loading} onClick={() => fileRef.current?.click()}>
        {st.loading ? 'Loading…' : st.fontName ? 'Replace…' : 'Load SoundFont…'}
      </button>
      {st.fontName && !st.loading && (
        <button onClick={() => void removeSoundFont()} title="Remove the SoundFont from this browser">
          ×
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept=".sf2,.sf3,.dls"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void loadSoundFontFile(file);
        }}
      />
      {st.error && (
        <span className="sound-error" role="alert">
          {st.error}
        </span>
      )}
    </div>
  );
}
