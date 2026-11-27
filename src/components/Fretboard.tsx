import { useMemo, useRef, useState } from 'react';
import type { EditorState } from '../editor/editorStore';
import { audition, placeNote, placePitch, previewNote, shiftSelection } from '../editor/actions';
import { clampShift, type NoteShift } from '../model/commands';
import { editor } from '../session';
import { laneLabel } from '../model/drums';
import { isStringed } from '../model/instruments';
import { pitchClassName, pitchName, STANDARD_TUNING, stringLabel } from '../model/music';
import { bestFingering, type Spot } from '../model/transfer';
import type { ID, Song, Track } from '../model/types';

const W = 1200;
const OPEN_W = 58;
const NUT_W = 8;
const TOP = 22;
const SPACING = 30;
const LABEL_H = 22;
const INLAYS = [3, 5, 7, 9, 15, 17, 19, 21];
const DOUBLE_INLAYS = [12, 24];

/** The neck shown for entering notes on a piano track: a standard-tuned guitar. */
const PIANO_NECK: Pick<Track, 'tuning' | 'frets'> = { tuning: STANDARD_TUNING, frets: 22 };

interface Props {
  song: Song;
  ed: EditorState;
}

export function Fretboard({ song, ed }: Props) {
  const track = song.tracks[ed.trackId];
  const [hover, setHover] = useState<{ s: number; f: number } | null>(null);
  /** Dragging notes to another string/fret: the grabbed note, the notes moving with it, and the shift so far. */
  const [drag, setDrag] = useState<{ anchor: ID; ids: ID[]; shift: NoteShift } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Guitar and bass show their own strings. A piano track gets a guitar neck: clicking places that pitch.
  const ownNeck = !!track && isStringed(track.kind);
  const neck = ownNeck ? track : PIANO_NECK;

  const geom = useMemo(() => {
    if (!neck) return null;
    const N = neck.frets;
    const boardStart = OPEN_W + NUT_W;
    const boardW = W - boardStart - 12;
    // Blend of real fret spacing (narrowing up the neck) and equal spacing,
    // so high frets stay clickable.
    const real = (f: number) => 1 - Math.pow(2, -f / 12);
    const wireX = (f: number) => boardStart + boardW * (0.6 * (real(f) / real(N)) + 0.4 * (f / N));
    const cellLeft = (f: number) => (f === 0 ? 0 : wireX(f - 1));
    const cellRight = (f: number) => (f === 0 ? OPEN_W : wireX(f));
    // Open-string markers sit right of the string-name labels.
    const centerX = (f: number) => (f === 0 ? OPEN_W - 16 : (cellLeft(f) + cellRight(f)) / 2);
    const strings = neck.tuning.length;
    const stringY = (s: number) => TOP + s * SPACING;
    const boardH = (strings - 1) * SPACING + TOP * 2;
    return { N, boardStart, wireX, cellLeft, cellRight, centerX, strings, stringY, boardH };
  }, [neck]);

  if (!track || !geom || track.kind === 'drums') return null;
  const { N, boardStart, wireX, cellLeft, cellRight, centerX, strings, stringY, boardH } = geom;
  const height = boardH + LABEL_H;

  // Notes sounding at the playhead (while playing) or at the edit cursor.
  const focus = ed.playhead ?? ed.cursor;
  const sounding = Object.values(song.notes).filter(
    (n) => n.trackId === track.id && n.start <= focus && focus < n.start + n.duration,
  );
  // Where each sounding note sits on the neck: its own string and fret, or for a piano track the most
  // comfortable shape for the sounding pitches (notes the neck can't hold aren't shown).
  const spots = new Map<ID, Spot>();
  if (ownNeck) {
    for (const n of sounding) spots.set(n.id, { string: n.string, fret: n.fret });
  } else {
    const pitch = (n: (typeof sounding)[number]) => track.tuning[n.string] + n.fret;
    const byPitch = [...sounding].sort((a, b) => pitch(b) - pitch(a));
    const shape = bestFingering(byPitch.map(pitch), neck);
    byPitch.forEach((n, i) => shape[i] && spots.set(n.id, shape[i]));
  }
  const selected = new Set(ed.selection);
  const moving = new Set(drag?.ids ?? []);

  /** The string and fret under a mouse position (clamped to the board). */
  const cellAt = (clientX: number, clientY: number) => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    const s = Math.min(strings - 1, Math.max(0, Math.round((p.y - TOP) / SPACING)));
    let f = 0;
    while (f < N && p.x >= cellRight(f)) f++;
    return { s, f };
  };

  /**
   * Grab a note that starts at the cursor and drop it on another string/fret. If it's part of a selection,
   * the selected notes move with it by the same number of strings and frets (a chord keeps its shape).
   * A click without moving just selects the note (Shift adds or removes it).
   */
  const onNoteDown = (e: React.MouseEvent, id: ID) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const n = song.notes[id];
    const st = editor.get();
    const selection = e.shiftKey
      ? st.selection.includes(id)
        ? st.selection.filter((x) => x !== id)
        : [...st.selection, id]
      : st.selection.includes(id)
        ? st.selection
        : [id];
    editor.set({ selection, cursorString: n.string });
    if (!selection.includes(id)) return;
    previewNote(id);
    const from = { s: n.string, f: n.fret };
    let shift: NoteShift = { ticks: 0, lanes: 0, frets: 0 };
    setHover(null);
    setDrag({ anchor: id, ids: selection, shift });
    const onMove = (ev: MouseEvent) => {
      const cell = cellAt(ev.clientX, ev.clientY);
      if (!cell) return;
      const next = clampShift(song, selection, { ticks: 0, lanes: cell.s - from.s, frets: cell.f - from.f });
      if (next.lanes === shift.lanes && next.frets === shift.frets) return;
      shift = next;
      setDrag({ anchor: id, ids: selection, shift });
      audition(track.id, track.tuning[from.s + shift.lanes] + from.f + shift.frets);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setDrag(null);
      if (shift.lanes || shift.frets) {
        shiftSelection(shift);
        editor.set({ cursorString: from.s + shift.lanes });
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Inlays sit in the middle of the neck; double dots one string-gap either side (works for 4 or 6 strings).
  const midY = (stringY(0) + stringY(strings - 1)) / 2;
  const bass = track.kind === 'bass';

  return (
    <div className="fretboard">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        className={drag ? 'dragging' : undefined}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="wood" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#4a3424" />
            <stop offset="0.5" stopColor="#3b291c" />
            <stop offset="1" stopColor="#2e2016" />
          </linearGradient>
        </defs>

        <rect x={0} y={0} width={OPEN_W} height={boardH} className="fb-open" />
        <rect x={boardStart} y={0} width={wireX(N) - boardStart} height={boardH} fill="url(#wood)" />
        <rect x={OPEN_W} y={0} width={NUT_W} height={boardH} className="fb-nut" />

        {INLAYS.filter((f) => f <= N).map((f) => (
          <circle key={f} cx={centerX(f)} cy={midY} r={6} className="fb-inlay" />
        ))}
        {DOUBLE_INLAYS.filter((f) => f <= N).map((f) => (
          <g key={f}>
            <circle cx={centerX(f)} cy={midY - SPACING} r={6} className="fb-inlay" />
            <circle cx={centerX(f)} cy={midY + SPACING} r={6} className="fb-inlay" />
          </g>
        ))}

        {Array.from({ length: N }, (_, i) => i + 1).map((f) => (
          <line key={f} x1={wireX(f)} x2={wireX(f)} y1={0} y2={boardH} className="fb-wire" />
        ))}

        {neck.tuning.map((_, s) => (
          <g key={s}>
            {ownNeck && s === ed.cursorString && (
              <rect x={0} y={stringY(s) - SPACING / 2} width={wireX(N)} height={SPACING} className="fb-cursor-row" />
            )}
            <line
              x1={20}
              x2={wireX(N)}
              y1={stringY(s)}
              y2={stringY(s)}
              className={bass || s >= strings - 3 ? 'fb-string wound' : 'fb-string'}
              strokeWidth={bass ? 2.2 + s * 0.5 : 1 + s * 0.4}
            />
          </g>
        ))}

        {Array.from({ length: N + 1 }, (_, f) => f)
          .filter((f) => f === 0 || INLAYS.includes(f) || DOUBLE_INLAYS.includes(f) || f === 1)
          .map((f) => (
            <text key={f} x={centerX(f)} y={boardH + 16} className="fb-fretnum">
              {f}
            </text>
          ))}

        {neck.tuning.map((_, s) =>
          Array.from({ length: N + 1 }, (_, f) => (
            <rect
              key={`${s}-${f}`}
              x={cellLeft(f)}
              y={stringY(s) - SPACING / 2}
              width={cellRight(f) - cellLeft(f)}
              height={SPACING}
              className="fb-hit"
              onMouseEnter={() => !drag && setHover({ s, f })}
              onMouseDown={(e) => {
                e.preventDefault();
                if (ownNeck) placeNote(s, f, { advance: !e.shiftKey });
                else placePitch(neck.tuning[s] + f, { advance: !e.shiftKey });
              }}
            />
          )),
        )}

        {sounding.map((n) => {
          const spot = spots.get(n.id);
          if (!spot) return null;
          // Notes struck exactly at the cursor are bright; notes ringing over from earlier are dimmed.
          const isStart = ed.playing || n.start === ed.cursor;
          // Notes starting at the cursor can be dragged; ones ringing over from earlier let clicks through,
          // so clicking there still places a note.
          const grabbable = isStart && !ed.playing && ownNeck;
          const cls = [
            'fb-note',
            selected.has(n.id) ? 'selected' : '',
            isStart ? 'onset' : 'sustain',
            grabbable ? 'grabbable' : '',
            moving.has(n.id) ? 'moving' : '',
          ].join(' ');
          return (
            <g
              key={n.id}
              className={cls}
              pointerEvents={grabbable ? undefined : 'none'}
              onMouseDown={grabbable ? (e) => onNoteDown(e, n.id) : undefined}
            >
              <circle cx={centerX(spot.fret)} cy={stringY(spot.string)} r={11} />
              <text x={centerX(spot.fret)} y={stringY(spot.string) + 4}>
                {pitchClassName(track.tuning[n.string] + n.fret)}
              </text>
            </g>
          );
        })}

        {drag &&
          (drag.shift.lanes !== 0 || drag.shift.frets !== 0) &&
          sounding.map((n) => {
            if (!moving.has(n.id)) return null;
            const id = n.id;
            const s = n.string + drag.shift.lanes;
            const f = n.fret + drag.shift.frets;
            return (
              <g key={id} className="fb-note onset selected drop" pointerEvents="none">
                <circle cx={centerX(f)} cy={stringY(s)} r={11} />
                <text x={centerX(f)} y={stringY(s) + 4}>
                  {pitchClassName(track.tuning[s] + f)}
                </text>
              </g>
            );
          })}

        {hover && (
          <g className="fb-ghost" pointerEvents="none">
            <circle cx={centerX(hover.f)} cy={stringY(hover.s)} r={11} />
            <text x={centerX(hover.f)} y={stringY(hover.s) + 4}>
              {pitchClassName(neck.tuning[hover.s] + hover.f)}
            </text>
          </g>
        )}

        {neck.tuning.map((_, s) => (
          <text key={s} x={10} y={stringY(s) + 4} className="fb-stringname" pointerEvents="none">
            {ownNeck ? laneLabel(track, s) : stringLabel(neck.tuning, s)}
          </text>
        ))}
      </svg>
      <div className="fb-status">
        {drag && song.notes[drag.anchor] ? (
          (() => {
            const n = song.notes[drag.anchor];
            const s = n.string + drag.shift.lanes;
            const f = n.fret + drag.shift.frets;
            return (
              <>
                Moving to string {s + 1} · Fret {f} · <b>{pitchName(track.tuning[s] + f)}</b>
                {drag.ids.length > 1 && <span className="muted"> — {drag.ids.length} notes move together</span>}
              </>
            );
          })()
        ) : hover ? (
          <>
            String {hover.s + 1} · Fret {hover.f} · <b>{pitchName(neck.tuning[hover.s] + hover.f)}</b>
            <span className="muted">
              {' '}
              — click to place, shift-click to stack a chord
              {ownNeck ? '; drag a note to move it' : ' (placed on the piano at this pitch)'}
            </span>
          </>
        ) : (
          <span className="muted">
            Click a fret to place a note at the cursor. Showing notes sounding at{' '}
            {ed.playing ? 'the playhead' : 'the cursor'}.
          </span>
        )}
      </div>
    </div>
  );
}
