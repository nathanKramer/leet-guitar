import { useEffect } from 'react';
import { Fretboard } from './components/Fretboard';
import { Timeline } from './components/Timeline';
import { Toolbar } from './components/Toolbar';
import { useStore } from './editor/editorStore';
import { handleKeyDown } from './editor/keyboard';
import { describeDuration, PPQ } from './model/durations';
import { editor, usePeers, useSong } from './session';

function position(tick: number, beatsPerBar: number, beatUnit: number) {
  const beat = (PPQ * 4) / beatUnit;
  const bar = Math.floor(tick / (beat * beatsPerBar)) + 1;
  const beatInBar = Math.floor(tick / beat) % beatsPerBar + 1;
  const sub = tick % beat;
  return `${bar}.${beatInBar}${sub ? ` +${sub}t` : ''}`;
}

export default function App() {
  const song = useSong();
  const ed = useStore(editor);
  const peers = usePeers();

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const sel = ed.selection.map((id) => song.notes[id]).filter(Boolean);
  const selDur = sel.length === 1 ? describeDuration(sel[0].duration) : null;

  return (
    <div className="app">
      <Toolbar song={song} ed={ed} peers={peers} />
      <main>
        <Fretboard song={song} ed={ed} />
        <Timeline song={song} ed={ed} peers={peers} />
        <footer className="statusbar">
          <span>
            Cursor <b>{position(ed.cursor, song.meta.beatsPerBar, song.meta.beatUnit)}</b>
          </span>
          <span>
            {sel.length ? (
              <>
                {sel.length} selected
                {selDur && ` · ${selDur.base}${selDur.triplet ? ' triplet' : ''}`}
              </>
            ) : (
              'No selection'
            )}
          </span>
          <span className="keys">
            <kbd>W H Q E S</kbd> note value · <kbd>T</kbd> triplet · <kbd>0-9</kbd> type fret ·{' '}
            <kbd>←→</kbd> cursor · <kbd>↑↓</kbd> string · <kbd>Shift ↑↓</kbd> fret ± ·{' '}
            <kbd>Alt ←→↑↓</kbd> move notes · <kbd>Space</kbd> play · <kbd>Del</kbd> delete
          </span>
        </footer>
      </main>
    </div>
  );
}
