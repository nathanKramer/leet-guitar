import { placeNote } from '../editor/actions';
import type { EditorState } from '../editor/editorStore';
import { drumName, isCymbal } from '../model/drums';
import type { Song } from '../model/types';
import { editor } from '../session';

/** Entry surface for drum tracks, in place of the fretboard. */
export function DrumPads({ song, ed }: { song: Song; ed: EditorState }) {
  const track = song.tracks[ed.trackId];
  if (!track || track.kind !== 'drums') return null;

  // Light up pads hit at the playhead (while playing) or struck at the cursor.
  const focus = ed.playhead ?? ed.cursor;
  const lit = new Set(
    Object.values(song.notes)
      .filter((n) => n.trackId === track.id && (ed.playing ? n.start <= focus && focus < n.start + n.duration : n.start === ed.cursor))
      .map((n) => n.string),
  );

  return (
    <div className="drumpads">
      <div className="pads">
        {track.tuning.map((pitch, lane) => (
          <button
            key={lane}
            className={['pad', `s${lane % 6}`, lit.has(lane) ? 'lit' : '', lane === ed.cursorString ? 'cursor' : ''].join(' ')}
            onMouseDown={(e) => {
              e.preventDefault();
              placeNote(lane, 0, { advance: !e.shiftKey });
            }}
            onMouseEnter={() => editor.set({ cursorString: lane })}
          >
            <span className="pad-glyph">{isCymbal(pitch) ? '×' : '●'}</span>
            <span className="pad-name">{drumName(pitch)}</span>
            {lane < 9 && <kbd>{lane + 1}</kbd>}
          </button>
        ))}
      </div>
      <div className="fb-status muted">
        Click a pad (or press its number) to add a hit at the cursor; shift-click to stack hits. Clicking an empty cell
        in the timeline adds a hit there.
      </div>
    </div>
  );
}
