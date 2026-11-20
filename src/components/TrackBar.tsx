import { useState } from 'react';
import * as act from '../editor/actions';
import type { EditorState } from '../editor/editorStore';
import { setTrackProgram, sortedTracks } from '../model/commands';
import { TRACK_KIND_ORDER, TRACK_KINDS } from '../model/instruments';
import { docStore } from '../session';
import type { Song } from '../model/types';

export function TrackBar({ song, ed }: { song: Song; ed: EditorState }) {
  const tracks = sortedTracks(song);
  const [renaming, setRenaming] = useState<string | null>(null);

  return (
    <nav className="trackbar" aria-label="Tracks">
      {tracks.map((t) => {
        const active = t.id === ed.trackId;
        const muted = ed.mutedTracks.includes(t.id);
        return (
          <div key={t.id} className={['track-tab', active ? 'active' : '', muted ? 'muted-track' : ''].join(' ')}>
            <button className="tab-main" onClick={() => act.selectTrack(t.id)} onDoubleClick={() => setRenaming(t.id)} title="Double-click to rename">
              <span className={`tab-icon ${t.kind}`}>{t.kind === 'drums' ? '🥁' : '🎸'}</span>
              {renaming === t.id ? (
                <input
                  autoFocus
                  defaultValue={t.name}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    act.renameTrack(t.id, e.target.value);
                    setRenaming(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                />
              ) : (
                <span>{t.name}</span>
              )}
            </button>
            {active && (
              <select
                className="tab-instrument"
                value={t.program}
                onChange={(e) => docStore.transact(setTrackProgram(t.id, Number(e.target.value)))}
                title={
                  t.kind === 'drums'
                    ? 'Drum kit (heard with a SoundFont that has it; exported to MIDI)'
                    : 'Instrument (heard with a SoundFont; exported to MIDI)'
                }
              >
                {TRACK_KINDS[t.kind].programs.map((p) => (
                  <option key={p.program} value={p.program}>
                    {p.name}
                  </option>
                ))}
                {!TRACK_KINDS[t.kind].programs.some((p) => p.program === t.program) && (
                  <option value={t.program}>Program {t.program + 1}</option>
                )}
              </select>
            )}
            <button
              className={muted ? 'tab-btn on' : 'tab-btn'}
              onClick={() => act.toggleMute(t.id)}
              title={muted ? 'Unmute' : 'Mute'}
              aria-pressed={muted}
            >
              M
            </button>
            {tracks.length > 1 && (
              <button className="tab-btn" onClick={() => act.deleteTrack(t.id)} title="Delete track (undoable)">
                ×
              </button>
            )}
          </div>
        );
      })}
      {TRACK_KIND_ORDER.map((kind) => (
        <button key={kind} onClick={() => act.addTrack(kind)}>
          + {TRACK_KINDS[kind].label}
        </button>
      ))}
    </nav>
  );
}
