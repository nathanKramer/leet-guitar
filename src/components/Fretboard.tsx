import { useMemo, useState } from 'react';
import type { EditorState } from '../editor/editorStore';
import { placeNote } from '../editor/actions';
import { pitchClassName, pitchName, stringLabel } from '../model/music';
import type { Song } from '../model/types';

const W = 1200;
const OPEN_W = 58;
const NUT_W = 8;
const TOP = 22;
const SPACING = 30;
const LABEL_H = 22;
const INLAYS = [3, 5, 7, 9, 15, 17, 19, 21];
const DOUBLE_INLAYS = [12, 24];

interface Props {
  song: Song;
  ed: EditorState;
}

export function Fretboard({ song, ed }: Props) {
  const track = song.tracks[ed.trackId];
  const [hover, setHover] = useState<{ s: number; f: number } | null>(null);

  const geom = useMemo(() => {
    if (!track) return null;
    const N = track.frets;
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
    const strings = track.tuning.length;
    const stringY = (s: number) => TOP + s * SPACING;
    const boardH = (strings - 1) * SPACING + TOP * 2;
    return { N, boardStart, wireX, cellLeft, cellRight, centerX, strings, stringY, boardH };
  }, [track]);

  if (!track || !geom) return null;
  const { N, boardStart, wireX, cellLeft, cellRight, centerX, strings, stringY, boardH } = geom;
  const height = boardH + LABEL_H;

  // Notes sounding at the playhead (while playing) or at the edit cursor.
  const focus = ed.playhead ?? ed.cursor;
  const sounding = Object.values(song.notes).filter(
    (n) => n.trackId === track.id && n.start <= focus && focus < n.start + n.duration,
  );
  const selected = new Set(ed.selection);

  const midY = (stringY(Math.floor((strings - 1) / 2)) + stringY(Math.ceil((strings - 1) / 2))) / 2;

  return (
    <div className="fretboard">
      <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="xMidYMid meet" onMouseLeave={() => setHover(null)}>
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
            <circle cx={centerX(f)} cy={(stringY(1) + stringY(2)) / 2} r={6} className="fb-inlay" />
            <circle cx={centerX(f)} cy={(stringY(strings - 3) + stringY(strings - 2)) / 2} r={6} className="fb-inlay" />
          </g>
        ))}

        {Array.from({ length: N }, (_, i) => i + 1).map((f) => (
          <line key={f} x1={wireX(f)} x2={wireX(f)} y1={0} y2={boardH} className="fb-wire" />
        ))}

        {track.tuning.map((_, s) => (
          <g key={s}>
            {s === ed.cursorString && (
              <rect x={0} y={stringY(s) - SPACING / 2} width={wireX(N)} height={SPACING} className="fb-cursor-row" />
            )}
            <line
              x1={0}
              x2={wireX(N)}
              y1={stringY(s)}
              y2={stringY(s)}
              className={s >= strings - 3 ? 'fb-string wound' : 'fb-string'}
              strokeWidth={1 + s * 0.4}
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

        {track.tuning.map((_, s) =>
          Array.from({ length: N + 1 }, (_, f) => (
            <rect
              key={`${s}-${f}`}
              x={cellLeft(f)}
              y={stringY(s) - SPACING / 2}
              width={cellRight(f) - cellLeft(f)}
              height={SPACING}
              className="fb-hit"
              onMouseEnter={() => setHover({ s, f })}
              onMouseDown={(e) => {
                e.preventDefault();
                placeNote(s, f, { advance: !e.shiftKey });
              }}
            />
          )),
        )}

        {sounding.map((n) => {
          // Notes struck exactly at the cursor are bright; notes ringing over from earlier are dimmed.
          const isStart = ed.playing || n.start === ed.cursor;
          const cls = ['fb-note', selected.has(n.id) ? 'selected' : '', isStart ? 'onset' : 'sustain'].join(' ');
          return (
            <g key={n.id} className={cls} pointerEvents="none">
              <circle cx={centerX(n.fret)} cy={stringY(n.string)} r={11} />
              <text x={centerX(n.fret)} y={stringY(n.string) + 4}>
                {pitchClassName(track.tuning[n.string] + n.fret)}
              </text>
            </g>
          );
        })}

        {hover && (
          <g className="fb-ghost" pointerEvents="none">
            <circle cx={centerX(hover.f)} cy={stringY(hover.s)} r={11} />
            <text x={centerX(hover.f)} y={stringY(hover.s) + 4}>
              {pitchClassName(track.tuning[hover.s] + hover.f)}
            </text>
          </g>
        )}

        {track.tuning.map((_, s) => (
          <text key={s} x={10} y={stringY(s) + 4} className="fb-stringname" pointerEvents="none">
            {stringLabel(track.tuning, s)}
          </text>
        ))}
      </svg>
      <div className="fb-status">
        {hover ? (
          <>
            String {hover.s + 1} · Fret {hover.f} · <b>{pitchName(track.tuning[hover.s] + hover.f)}</b>
            <span className="muted"> — click to place, shift-click to stack a chord</span>
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
