import { useEffect, useRef, useState } from 'react';
import { setTuning } from '../editor/actions';
import { useAnchoredPopover } from './popover';
import { pitchName } from '../model/music';
import {
  matchPreset,
  MAX_STRINGS,
  MIN_STRINGS,
  NEW_STRING_INTERVAL,
  presetsFor,
  spellTuning,
  tuningLabel,
} from '../model/tunings';
import type { Track } from '../model/types';

/** Tuning button + popover for a guitar or bass track: presets, per-string adjustment, string count. */
export function TuningPicker({ track }: { track: Track }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const style = useAnchoredPopover(open, buttonRef, 300);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const tuning = track.tuning;
  const presets = presetsFor(track.kind);
  const current = matchPreset(track.kind, tuning);
  const retune = (next: number[]) => setTuning(track.id, next);
  const nudge = (string: number, delta: number) =>
    retune(tuning.map((p, i) => (i === string ? Math.min(127, Math.max(0, p + delta)) : p)));
  const counts = [...new Set(presets.map((p) => p.pitches.length))].sort((a, b) => a - b);

  return (
    <div className="tuning" ref={ref}>
      <button
        ref={buttonRef}
        className="tab-btn tuning-btn"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={`Tuning: ${spellTuning(tuning)} (click to change)`}
      >
        {tuningLabel(track.kind, tuning)}
      </button>
      {open && (
        <div className="tuning-pop" style={style} role="dialog" aria-label={`${track.name} tuning`}>
          <label className="field">
            Preset
            <select
              value={current ? presets.indexOf(current) : 'custom'}
              onChange={(e) => retune(presets[Number(e.target.value)].pitches)}
            >
              {!current && (
                <option value="custom" disabled>
                  Custom ({spellTuning(tuning)})
                </option>
              )}
              {counts.map((n) => (
                <optgroup key={n} label={`${n} strings`}>
                  {presets.map((p, i) =>
                    p.pitches.length === n ? (
                      <option key={i} value={i}>
                        {p.name} — {spellTuning(p.pitches)}
                      </option>
                    ) : null,
                  )}
                </optgroup>
              ))}
            </select>
          </label>

          <div className="tuning-strings">
            {tuning.map((pitch, s) => (
              <div key={s} className="tuning-row">
                <span className="tuning-index">{s + 1}</span>
                <button onClick={() => nudge(s, -1)} aria-label={`Lower string ${s + 1}`} title="Down a semitone">
                  −
                </button>
                <span className="tuning-note">{pitchName(pitch)}</span>
                <button onClick={() => nudge(s, 1)} aria-label={`Raise string ${s + 1}`} title="Up a semitone">
                  +
                </button>
              </div>
            ))}
          </div>

          <div className="tuning-actions">
            <button
              disabled={tuning.length >= MAX_STRINGS}
              onClick={() => retune([...tuning, Math.max(0, tuning[tuning.length - 1] - NEW_STRING_INTERVAL)])}
            >
              + Low string
            </button>
            <button disabled={tuning.length <= MIN_STRINGS} onClick={() => retune(tuning.slice(0, -1))}>
              − Low string
            </button>
          </div>
          <p className="tuning-note-text">Notes keep their string and fret when you retune, so the tab stays the same.</p>
        </div>
      )}
    </div>
  );
}
