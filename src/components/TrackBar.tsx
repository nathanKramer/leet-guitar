import { useState } from 'react';
import * as act from '../editor/actions';
import type { EditorState } from '../editor/editorStore';
import { useStore } from '../editor/editorStore';
import { sound } from '../editor/sound';
import { sortedTracks } from '../model/commands';
import { familyOf, groupByFamily, type Instrument } from '../model/gm';
import { instrumentChoices, isStringed, TRACK_KIND_ORDER, TRACK_KINDS } from '../model/instruments';
import type { Song, Track, TrackKind } from '../model/types';
import { InstrumentPicker } from './InstrumentPicker';
import { TuningPicker } from './TuningPicker';

const TAB_ICONS: Record<TrackKind, string> = { guitar: '🎸', bass: '🎸', piano: '🎹', drums: '🥁' };
/** Piano-roll tracks playing something other than a piano. */
const OTHER_INSTRUMENT_ICON = '🎵';

const key = (i: { bank: number; program: number }) => `${i.bank}:${i.program}`;

/** The active tab's instrument menu (grouped by family on piano-roll tracks, which can play anything). */
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
      className="tab-instrument"
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
      {!current && (
        <option value={key(track)}>
          {track.bank ? `Bank ${track.bank} ` : ''}Program {track.program + 1}
        </option>
      )}
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

export function TrackBar({ song, ed }: { song: Song; ed: EditorState }) {
  const tracks = sortedTracks(song);
  const font = useStore(sound).instruments;
  const [renaming, setRenaming] = useState<string | null>(null);

  return (
    <nav className="trackbar" aria-label="Tracks">
      {tracks.map((t) => {
        const active = t.id === ed.trackId;
        const muted = ed.mutedTracks.includes(t.id);
        const soloed = ed.soloTracks.includes(t.id);
        const silent = !act.isAudible(t.id, ed);
        return (
          <div
            key={t.id}
            className={['track-tab', active ? 'active' : '', muted ? 'muted-track' : '', silent ? 'silent-track' : ''].join(' ')}
          >
            <button className="tab-main" onClick={() => act.selectTrack(t.id)} onDoubleClick={() => setRenaming(t.id)} title="Double-click to rename">
              <span className={`tab-icon ${t.kind}`} title={t.kind === 'piano' ? familyOf(t.program) : undefined}>
                {t.kind === 'piano' && t.program >= 8 ? OTHER_INSTRUMENT_ICON : TAB_ICONS[t.kind]}
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
                <span>{t.name}</span>
              )}
            </button>
            {active && <InstrumentSelect track={t} font={font} />}
            {active && isStringed(t.kind) && <TuningPicker track={t} />}
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
      <InstrumentPicker />
    </nav>
  );
}
