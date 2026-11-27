import { useMemo, useState } from 'react';
import { placePitch } from '../editor/actions';
import type { EditorState } from '../editor/editorStore';
import { isStringed } from '../model/instruments';
import { isBlackKey, MIDDLE_C, pitchName } from '../model/music';
import type { Song, Track } from '../model/types';

const W = 1200;
const WHITE_H = 120;
const BLACK_H = 76;
const BLACK_RATIO = 0.62;

interface Key {
  pitch: number;
  black: boolean;
  /** Outside the instrument's range (guitar and bass keyboards are padded out to whole octaves). */
  out: boolean;
  x: number;
  w: number;
}

/** The keys to draw, low to high: a piano's own keys, or a guitar or bass's range padded out to whole octaves. */
function keyRange(track: Track): { pitches: number[]; lo: number; hi: number } {
  if (!isStringed(track.kind)) {
    const pitches = [...track.tuning].sort((a, b) => a - b);
    return { pitches, lo: pitches[0], hi: pitches[pitches.length - 1] };
  }
  const lo = Math.min(...track.tuning);
  const hi = Math.max(...track.tuning) + track.frets;
  const from = lo - (lo % 12);
  const to = hi + 11 - (hi % 12);
  return { pitches: Array.from({ length: to - from + 1 }, (_, i) => from + i), lo, hi };
}

/**
 * Click a key to place a note at the cursor. The entry surface for piano tracks, and for guitar and bass when
 * chosen in place of the fretboard (the string and fret are then picked for each note).
 */
export function PianoKeys({ song, ed }: { song: Song; ed: EditorState }) {
  const track = song.tracks[ed.trackId];
  const [hover, setHover] = useState<number | null>(null);

  const keys = useMemo(() => {
    if (!track || track.kind === 'drums') return [];
    const { pitches, lo, hi } = keyRange(track);
    const whites = pitches.filter((p) => !isBlackKey(p)).length;
    const whiteW = W / whites;
    const blackW = whiteW * BLACK_RATIO;
    let whiteIndex = 0;
    return pitches.map<Key>((pitch) => {
      const out = pitch < lo || pitch > hi;
      if (isBlackKey(pitch)) return { pitch, out, black: true, x: whiteIndex * whiteW - blackW / 2, w: blackW };
      const key = { pitch, out, black: false, x: whiteIndex * whiteW, w: whiteW };
      whiteIndex++;
      return key;
    });
  }, [track]);

  if (!track || track.kind === 'drums') return null;
  const stringed = isStringed(track.kind);

  // Keys down at the playhead (while playing) or struck at the cursor; ringing-over notes are dimmer.
  const focus = ed.playhead ?? ed.cursor;
  const down = new Map<number, 'onset' | 'sustain'>();
  for (const n of Object.values(song.notes)) {
    if (n.trackId !== track.id || !(n.start <= focus && focus < n.start + n.duration)) continue;
    const pitch = track.tuning[n.string] + n.fret;
    if (ed.playing || n.start === ed.cursor) down.set(pitch, 'onset');
    else if (!down.has(pitch)) down.set(pitch, 'sustain');
  }
  // Piano lanes are keys, so the cursor row is a key; a guitar's cursor row is a string, which has no one key.
  const cursorPitch = stringed ? null : track.tuning[ed.cursorString];

  const renderKey = (k: Key) => {
    const state = down.get(k.pitch);
    const cls = [
      'pk-key',
      k.black ? 'black' : 'white',
      k.out ? 'out' : '',
      state ?? '',
      k.pitch === cursorPitch ? 'cursor' : '',
      k.pitch === hover ? 'hover' : '',
    ].join(' ');
    return (
      <g key={k.pitch}>
        <rect
          x={k.x}
          y={0}
          width={k.w}
          height={k.black ? BLACK_H : WHITE_H}
          rx={k.black ? 2 : 3}
          className={cls}
          onMouseEnter={() => setHover(k.out ? null : k.pitch)}
          onMouseDown={(e) => {
            e.preventDefault();
            if (!k.out) placePitch(k.pitch, { advance: !e.shiftKey });
          }}
        />
        {!k.black && k.pitch % 12 === 0 && (
          <text x={k.x + k.w / 2} y={WHITE_H - 8} className="pk-label" pointerEvents="none">
            {pitchName(k.pitch)}
          </text>
        )}
        {k.pitch === MIDDLE_C && <circle cx={k.x + k.w / 2} cy={WHITE_H - 26} r={3} className="pk-middle-c" pointerEvents="none" />}
      </g>
    );
  };

  return (
    <div className="pianokeys">
      <svg viewBox={`0 0 ${W} ${WHITE_H + 1}`} preserveAspectRatio="xMidYMid meet" onMouseLeave={() => setHover(null)}>
        {keys.filter((k) => !k.black).map(renderKey)}
        {keys.filter((k) => k.black).map(renderKey)}
      </svg>
      <div className="fb-status">
        {hover !== null ? (
          <>
            <b>{pitchName(hover)}</b>
            <span className="muted">
              {' '}
              — click to place, shift-click to stack a chord
              {stringed && '; the string and fret are picked for you'}
            </span>
          </>
        ) : (
          <span className="muted">
            Click a key to place a note at the cursor. Highlighted keys are sounding at{' '}
            {ed.playing ? 'the playhead' : 'the cursor'}
            {stringed ? '.' : '; the outlined key is the cursor row.'}
          </span>
        )}
      </div>
    </div>
  );
}
