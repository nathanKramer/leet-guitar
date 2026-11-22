import { useState } from 'react';
import * as act from '../editor/actions';
import type { EditorState } from '../editor/editorStore';
import { useStore } from '../editor/editorStore';
import { sound } from '../editor/sound';
import { sortedTracks } from '../model/commands';
import { familyOf, groupByFamily, type Instrument } from '../model/gm';
import { instrumentChoices, isStringed } from '../model/instruments';
import { tuningLabel } from '../model/tunings';
import type { Song, Track, TrackKind } from '../model/types';
import { AddTrackMenu } from './InstrumentPicker';
import { TuningPicker } from './TuningPicker';

const ICONS: Record<TrackKind, string> = {
  guitar: '🎸',
  bass: '🎸',
  piano: '🎹',
  drums: '🥁',
};
/** Piano-roll tracks playing something other than a piano. */
const OTHER_INSTRUMENT_ICON = '🎵';

const key = (i: { bank: number; program: number }) => `${i.bank}:${i.program}`;

function instrumentName(track: Track, font: Instrument[] | null) {
  const found = instrumentChoices(track.kind, font).find((i) => key(i) === key(track));
  return found?.name ?? `${track.bank ? `Bank ${track.bank} ` : ''}Program ${track.program + 1}`;
}

/** The active track's instrument menu (grouped by family on piano-roll tracks, which can play anything). */
function InstrumentSelect({ track, font }: { track: Track; font: Instrument[] | null }) {
  const choices = instrumentChoices(track.kind, font);
  const current = choices.find((i) => key(i) === key(track));
  const option = (i: Instrument) => (
    <option key={key(i)} value={key(i)}>
      {i.name}
    </option>
  );
  return (
    <select
      className="track-instrument"
      value={key(track)}
      onChange={(e) => {
        const next = choices.find((i) => key(i) === e.target.value);
        if (next) act.setInstrument(track.id, next, current?.name);
      }}
      title={
        track.kind === 'drums'
          ? 'Drum kit (heard with a SoundFont that has it; exported to MIDI)'
          : 'Instrument (heard with a SoundFont; exported to MIDI)'
      }
    >
      {!current && <option value={key(track)}>{instrumentName(track, font)}</option>}
      {track.kind === 'piano'
        ? groupByFamily(choices).map(({ family, instruments }) => (
            <optgroup key={family} label={family}>
              {instruments.map(option)}
            </optgroup>
          ))
        : choices.map(option)}
    </select>
  );
}

/** The song's tracks as a list: click to edit one; the active track shows its instrument and tuning controls. */
export function TrackList({ song, ed }: { song: Song; ed: EditorState }) {
  const tracks = sortedTracks(song);
  const font = useStore(sound).instruments;
  const [renaming, setRenaming] = useState<string | null>(null);
  const counts = new Map<string, number>();
  for (const n of Object.values(song.notes)) counts.set(n.trackId, (counts.get(n.trackId) ?? 0) + 1);

  return (
    <aside className="tracklist" aria-label="Tracks">
      <div className="tracklist-head">
        <span>Tracks</span>
        <span className="muted">{tracks.length}</span>
      </div>
      <ul>
        {tracks.map((t) => {
          const active = t.id === ed.trackId;
          const muted = ed.mutedTracks.includes(t.id);
          const soloed = ed.soloTracks.includes(t.id);
          const silent = !act.isAudible(t.id, ed);
          const summary = [instrumentName(t, font), isStringed(t.kind) ? tuningLabel(t.kind, t.tuning) : null]
            .filter(Boolean)
            .join(' · ');
          return (
            <li
              key={t.id}
              className={[
                'track-row',
                active ? 'active' : '',
                muted ? 'muted-track' : '',
                silent ? 'silent-track' : '',
              ].join(' ')}
              onClick={() => act.selectTrack(t.id)}
            >
              <div className="track-line">
                <span className={`tab-icon ${t.kind}`} title={t.kind === 'piano' ? familyOf(t.program) : undefined}>
                  {t.kind === 'piano' && t.program >= 8 ? OTHER_INSTRUMENT_ICON : ICONS[t.kind]}
                </span>
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
                  <span className="track-name" onDoubleClick={() => setRenaming(t.id)} title="Double-click to rename">
                    {t.name}
                  </span>
                )}
                <span className="track-btns" onClick={(e) => e.stopPropagation()}>
                  <button
                    className={muted ? 'tab-btn on' : 'tab-btn'}
                    onClick={() => act.toggleMute(t.id)}
                    title={muted ? 'Unmute' : 'Mute'}
                    aria-pressed={muted}
                  >
                    M
                  </button>
                  <button
                    className={soloed ? 'tab-btn on solo' : 'tab-btn'}
                    onClick={(e) => act.toggleSolo(t.id, e.altKey)}
                    title={soloed ? 'Unsolo' : 'Solo: play only soloed tracks (Alt-click to solo just this one)'}
                    aria-pressed={soloed}
                  >
                    S
                  </button>
                  {tracks.length > 1 && (
                    <button
                      className="tab-btn delete"
                      onClick={() => act.deleteTrack(t.id)}
                      title="Delete track (undoable)"
                    >
                      ×
                    </button>
                  )}
                </span>
              </div>
              {active ? (
                <div className="track-controls" onClick={(e) => e.stopPropagation()}>
                  <InstrumentSelect track={t} font={font} />
                  {isStringed(t.kind) && <TuningPicker track={t} />}
                </div>
              ) : (
                <div className="track-sub muted">
                  {summary}
                  {counts.get(t.id) ? ` · ${counts.get(t.id)} note${counts.get(t.id) === 1 ? '' : 's'}` : ''}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <AddTrackMenu />
    </aside>
  );
}
