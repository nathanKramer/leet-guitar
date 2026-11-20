import { useEffect, useState } from 'react';
import * as act from '../editor/actions';
import type { EditorState } from '../editor/editorStore';
import { downloadMidi, type ChannelMode } from '../midi/export';
import { setMeta } from '../model/commands';
import { BASE_DURATIONS, DURATION_LABELS } from '../model/durations';
import type { Song } from '../model/types';
import { awareness, docStore, editor } from '../session';
import type { PeerState } from '../sync/awareness';

const DURATION_KEYS = { whole: 'W', half: 'H', quarter: 'Q', eighth: 'E', sixteenth: 'S' } as const;

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
      </div>

      <div className="group">
        <button className="primary" onClick={act.togglePlay} title="Play / stop (Space)">
          {ed.playing ? '■ Stop' : '▶ Play'}
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
            title={`${d} note (${DURATION_KEYS[d]})`}
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
      </div>

      <div className="group">
        <button onClick={act.undo} disabled={!docStore.canUndo} title="Undo (Ctrl+Z)">
          ↶
        </button>
        <button onClick={act.redo} disabled={!docStore.canRedo} title="Redo (Ctrl+Shift+Z)">
          ↷
        </button>
        <button onClick={() => editor.set((s) => ({ zoom: Math.max(0.05, s.zoom / 1.25) }))} title="Zoom out">
          −
        </button>
        <button onClick={() => editor.set((s) => ({ zoom: Math.min(1, s.zoom * 1.25) }))} title="Zoom in">
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
