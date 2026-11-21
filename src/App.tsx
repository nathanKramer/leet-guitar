import { useEffect } from 'react';
import { DrumPads } from './components/DrumPads';
import { Fretboard } from './components/Fretboard';
import { PianoKeys } from './components/PianoKeys';
import { Timeline } from './components/Timeline';
import { Toolbar } from './components/Toolbar';
import { TrackBar } from './components/TrackBar';
import { selectTrack } from './editor/actions';
import { useStore } from './editor/editorStore';
import { handleKeyDown } from './editor/keyboard';
import { loadProjectFile } from './editor/project';
import { sortedTracks } from './model/commands';
import { describeDuration, DURATION_NAMES, PPQ } from './model/durations';
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
    // Dropping a project file anywhere on the page opens it.
    const hasFile = (e: DragEvent) => e.dataTransfer?.types.includes('Files');
    const onDragOver = (e: DragEvent) => {
      if (hasFile(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      const file = e.dataTransfer?.files[0];
      if (!file) return;
      e.preventDefault();
      void loadProjectFile(file);
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  // The active track can disappear (deleted here, by undo, or by a collaborator).
  useEffect(() => {
    if (!song.tracks[ed.trackId]) {
      const first = sortedTracks(song)[0];
      if (first) selectTrack(first.id);
    }
  }, [song, ed.trackId]);

  const sel = ed.selection.map((id) => song.notes[id]).filter(Boolean);
  const selDur = sel.length === 1 ? describeDuration(sel[0].duration) : null;

  return (
    <div className="app">
      <Toolbar song={song} ed={ed} peers={peers} />
      <main>
        <TrackBar song={song} ed={ed} />
        <Fretboard song={song} ed={ed} />
        <PianoKeys song={song} ed={ed} />
        <DrumPads song={song} ed={ed} />
        <Timeline song={song} ed={ed} peers={peers} />
        <footer className="statusbar">
          <span>
            Cursor <b>{position(ed.cursor, song.meta.beatsPerBar, song.meta.beatUnit)}</b>
          </span>
          {ed.notice && (
            <span className="notice" role="status">
              {ed.notice}
            </span>
          )}
          <span>
            {sel.length ? (
              <>
                {sel.length} selected
                {selDur && ` · ${DURATION_NAMES[selDur.base]}${selDur.triplet ? ' triplet' : ''}`}
              </>
            ) : (
              'No selection'
            )}
          </span>
          {song.tracks[ed.trackId]?.kind === 'piano' ? (
            <span className="keys">
              <kbd>W H Q E S [ ]</kbd> note value · <kbd>T</kbd> triplet · <kbd>←→</kbd> cursor · <kbd>↑↓</kbd> key ·{' '}
              <kbd>Alt ↑↓</kbd> semitone · <kbd>Shift ↑↓</kbd> octave · <kbd>Alt ←→</kbd> move notes ·{' '}
              <kbd>PgUp PgDn</kbd> row · <kbd>Space</kbd> play · <kbd>Del</kbd> delete
            </span>
          ) : song.tracks[ed.trackId]?.kind === 'drums' ? (
            <span className="keys">
              <kbd>W H Q E S [ ]</kbd> note value · <kbd>T</kbd> triplet · <kbd>1-9</kbd> pads · <kbd>←→</kbd> cursor ·{' '}
              <kbd>↑↓</kbd> lane · <kbd>Alt ←→↑↓</kbd> move hits · <kbd>PgUp PgDn</kbd> row · <kbd>Space</kbd> play · <kbd>Del</kbd> delete
            </span>
          ) : (
            <span className="keys">
              <kbd>W H Q E S [ ]</kbd> note value · <kbd>T</kbd> triplet · <kbd>0-9</kbd> type fret ·{' '}
              <kbd>←→</kbd> cursor · <kbd>↑↓</kbd> string · <kbd>Shift ↑↓</kbd> fret ± ·{' '}
              <kbd>Alt ←→↑↓</kbd> move notes · <kbd>PgUp PgDn</kbd> row · <kbd>Space</kbd> play · <kbd>Del</kbd> delete
            </span>
          )}
        </footer>
      </main>
    </div>
  );
}
