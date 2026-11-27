import { useEffect, useRef, useState } from 'react';
import * as act from '../editor/actions';
import type { EditorState } from '../editor/editorStore';
import { sortedPatterns } from '../model/commands';
import type { Song } from '../model/types';
import { useAnchoredPopover } from './popover';

const KIND_LABEL = { guitar: 'Guitar', bass: 'Bass', piano: 'Piano', drums: 'Drums' } as const;

/**
 * Saved patterns, under "+ Add track": with notes selected, a name field saves them as a pattern;
 * "+ Add pattern" inserts one on the active track at the playhead.
 */
export function Patterns({ song, ed }: { song: Song; ed: EditorState }) {
  const selected = ed.selection.filter((id) => song.notes[id]).length;
  const patterns = sortedPatterns(song);
  return (
    <div className="patterns">
      {selected > 0 && <SavePattern key={ed.selection.join()} count={selected} />}
      <AddPatternMenu patterns={patterns} />
    </div>
  );
}

function SavePattern({ count }: { count: number }) {
  const [name, setName] = useState('');
  const save = () => {
    if (act.savePattern(name)) setName('');
  };
  return (
    <form
      className="save-pattern"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
        }}
        placeholder={`Name ${count} note${count === 1 ? '' : 's'} as a pattern`}
        aria-label="Pattern name"
      />
      <button type="submit" disabled={!name.trim()} title="Save the selected notes as a pattern">
        Save
      </button>
    </form>
  );
}

function AddPatternMenu({ patterns }: { patterns: ReturnType<typeof sortedPatterns> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const style = useAnchoredPopover(open, buttonRef, 260);

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

  return (
    <div className="add-pattern" ref={ref}>
      <button
        ref={buttonRef}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        disabled={!patterns.length}
        title={patterns.length ? 'Insert a saved pattern at the playhead' : 'Select notes and name them to save a pattern'}
      >
        + Add pattern
      </button>
      {open && (
        <div className="instrument-pop" style={style} role="dialog" aria-label="Add a pattern">
          <div className="instrument-list">
            {patterns.map((p) => (
              <div key={p.id} className="pattern-row">
                <button
                  className="pattern-pick"
                  onClick={() => {
                    act.insertPattern(p.id);
                    setOpen(false);
                  }}
                >
                  {p.name}
                  <span className="muted">
                    {' '}
                    · {KIND_LABEL[p.kind]} · {p.notes.length} note{p.notes.length === 1 ? '' : 's'}
                  </span>
                </button>
                <button className="tab-btn delete" onClick={() => act.deletePattern(p.id)} title="Delete pattern (undoable)">
                  ×
                </button>
              </div>
            ))}
            {!patterns.length && <p className="muted">No patterns saved.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
