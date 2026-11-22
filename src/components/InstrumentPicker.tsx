import { useEffect, useMemo, useRef, useState } from 'react';
import { addInstrumentTrack, addTrack } from '../editor/actions';
import { useStore } from '../editor/editorStore';
import { sound } from '../editor/sound';
import { familyOf, GM_INSTRUMENTS, groupByFamily, type Instrument } from '../model/gm';
import { TRACK_KIND_ORDER, TRACK_KINDS } from '../model/instruments';
import { useAnchoredPopover } from './popover';

/**
 * "+ Add track": the four basic kinds, or any melodic instrument in the loaded SoundFont (General MIDI without
 * one), searchable and grouped by family.
 */
export function AddTrackMenu() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const style = useAnchoredPopover(open, buttonRef, 320);
  const st = useStore(sound);
  const all = st.instruments?.length ? st.instruments : GM_INSTRUMENTS;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (i: Instrument) =>
      !q || i.name.toLowerCase().includes(q) || familyOf(i.program).toLowerCase().includes(q);
    return groupByFamily(all.filter(match));
  }, [all, query]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };
  const pick = (i: Instrument) => {
    addInstrumentTrack(i);
    close();
  };

  return (
    <div className="add-track" ref={ref}>
      <button ref={buttonRef} onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Add a track">
        + Add track
      </button>
      {open && (
        <div className="instrument-pop" style={style} role="dialog" aria-label="Add a track">
          <div className="add-track-kinds">
            {TRACK_KIND_ORDER.map((kind) => (
              <button
                key={kind}
                onClick={() => {
                  addTrack(kind);
                  close();
                }}
              >
                {TRACK_KINDS[kind].label}
              </button>
            ))}
          </div>
          <input
            autoFocus
            type="search"
            placeholder="Or search instruments (e.g. kalimba, strings)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close();
              const first = groups[0]?.instruments[0];
              if (e.key === 'Enter' && first) pick(first);
            }}
          />
          <div className="instrument-list">
            {groups.map(({ family, instruments }) => (
              <section key={family}>
                <h4>{family}</h4>
                {instruments.map((i) => (
                  <button key={`${i.bank}:${i.program}`} onClick={() => pick(i)}>
                    {i.name}
                    {i.bank > 0 && <span className="muted"> · bank {i.bank}</span>}
                  </button>
                ))}
              </section>
            ))}
            {!groups.length && <p className="muted">No instruments match “{query}”.</p>}
          </div>
          <p className="instrument-note">
            {st.instruments?.length
              ? `${all.length} instruments from ${st.fontName}. Guitars and basses get a fretboard; everything else a piano roll.`
              : 'General MIDI instruments. Load a SoundFont to hear them (and see its own instruments); until then the built-in synth plays them as piano.'}
          </p>
        </div>
      )}
    </div>
  );
}
