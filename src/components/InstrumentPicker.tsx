import { useEffect, useMemo, useRef, useState } from 'react';
import { addInstrumentTrack } from '../editor/actions';
import { useStore } from '../editor/editorStore';
import { sound } from '../editor/sound';
import { familyOf, GM_INSTRUMENTS, groupByFamily, type Instrument } from '../model/gm';

/** "+ Instrument…": add a track for any melodic instrument in the loaded SoundFont (or General MIDI). */
export function InstrumentPicker() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
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
    const match = (i: Instrument) => !q || i.name.toLowerCase().includes(q) || familyOf(i.program).toLowerCase().includes(q);
    return groupByFamily(all.filter(match));
  }, [all, query]);

  const pick = (i: Instrument) => {
    addInstrumentTrack(i);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="instrument-picker" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Add a track for any instrument">
        + Instrument…
      </button>
      {open && (
        <div className="instrument-pop" role="dialog" aria-label="Add an instrument track">
          <input
            autoFocus
            type="search"
            placeholder="Search instruments (e.g. kalimba, strings)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
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
