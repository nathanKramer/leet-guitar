import { useEffect, useMemo, useRef, useState } from 'react';
import type { EditorState } from '../editor/editorStore';
import { moveSelection, placeNote, stepTicks } from '../editor/actions';
import { barTicks, beatTicks, describeDuration } from '../model/durations';
import { isCymbal, laneLabel } from '../model/drums';
import { isStringed } from '../model/instruments';
import { visibleLanes } from '../model/lanes';
import { isBlackKey, pitchName } from '../model/music';
import type { ID, Note, Song } from '../model/types';
import { editor } from '../session';
import type { PeerState } from '../sync/awareness';

const RULER_H = 24;
const PAD = 8;
const ROW_H = 26;
const CHIP_H = 20;
const PIANO_ROW_H = 14;
const PIANO_CHIP_H = 12;

interface Props {
  song: Song;
  ed: EditorState;
  peers: PeerState[];
}

interface Drag {
  ids: ID[];
  x0: number;
  dx: number;
}

export function Timeline({ song, ed, peers }: Props) {
  const track = song.tracks[ed.trackId];
  const scrollRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  const notes = useMemo(
    () => Object.values(song.notes).filter((n) => n.trackId === ed.trackId),
    [song.notes, ed.trackId],
  );

  const ppt = ed.zoom;
  const step = stepTicks();
  const bar = barTicks(song.meta);
  const beat = beatTicks(song.meta);
  const lastEnd = notes.reduce((m, n) => Math.max(m, n.start + n.duration), 0);
  const bars = Math.max(8, Math.ceil(Math.max(lastEnd, ed.cursor + step) / bar) + 2);
  const total = bars * bar;
  const width = total * ppt;
  const piano = track?.kind === 'piano';
  const rowH = piano ? PIANO_ROW_H : ROW_H;
  const chipH = piano ? PIANO_CHIP_H : CHIP_H;
  const [laneStart, laneCount] = useMemo(
    () => visibleLanes(track?.kind ?? 'guitar', track?.tuning.length ?? 6, [...notes.map((n) => n.string), ed.cursorString]),
    [track?.kind, track?.tuning.length, notes, ed.cursorString],
  );
  const lanes = Array.from({ length: laneCount }, (_, i) => laneStart + i);
  const inView = (lane: number) => lane >= laneStart && lane < laneStart + laneCount;
  const height = RULER_H + PAD * 2 + laneCount * rowH;
  const rowY = (s: number) => RULER_H + PAD + (s - laneStart) * rowH + rowH / 2;
  /** On-screen box of a note chip; shared by rendering and box selection. */
  const chipRect = (n: Note, start = n.start) => ({
    x: start * ppt + 1,
    w: Math.max(n.duration * ppt - 2, piano ? 6 : 14),
    y: rowY(n.string) - chipH / 2,
  });
  const [marquee, setMarquee] = useState<{ x0: number; x1: number; y0: number; y1: number } | null>(null);

  // Snapped drag offset, applied to dragged notes as a live preview.
  const dragDelta = drag ? Math.round(drag.dx / ppt / step) * step : 0;
  const dragging = new Set(drag?.ids ?? []);
  const selected = new Set(ed.selection);

  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: MouseEvent) => setDrag((d) => d && { ...d, dx: e.clientX - d.x0 });
    const onUp = () => {
      const d = dragRef.current;
      if (d) {
        const delta = Math.round(d.dx / ppt / step) * step;
        if (delta !== 0) moveSelection(delta);
      }
      setDrag(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp, { once: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drag !== null, ppt, step]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the cursor / playhead in view.
  const focus = ed.playhead ?? ed.cursor;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const x = focus * ppt;
    if (x < el.scrollLeft + 24 || x > el.scrollLeft + el.clientWidth - 60) {
      el.scrollLeft = Math.max(0, x - el.clientWidth * 0.25);
    }
  }, [focus, ppt]);

  if (!track) return null;
  const isDrums = track.kind === 'drums';
  const clickToAdd = !isStringed(track.kind);

  const onBackgroundDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const svg = svgRef.current!;
    const toSvg = (ev: { clientX: number; clientY: number }) => {
      const r = svg.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    };
    const { x, y } = toSvg(e);
    const tick = Math.max(0, Math.floor(x / ppt / step) * step);
    const s = laneStart + Math.floor((y - RULER_H - PAD) / rowH);
    const onLane = y >= RULER_H + PAD && inView(s);
    const base = e.shiftKey ? editor.get().selection : [];
    editor.set((st) => ({
      cursor: tick,
      cursorString: onLane ? s : st.cursorString,
      selection: base,
    }));

    // Dragging from empty space draws a selection box; anything it touches is selected.
    let active = false;
    const onMove = (ev: MouseEvent) => {
      const p = toSvg(ev);
      if (!active && Math.hypot(p.x - x, p.y - y) < 4) return;
      active = true;
      const box = { x0: Math.min(x, p.x), x1: Math.max(x, p.x), y0: Math.min(y, p.y), y1: Math.max(y, p.y) };
      setMarquee(box);
      const hits = notes
        .filter((n) => {
          const c = chipRect(n);
          return c.x < box.x1 && c.x + c.w > box.x0 && c.y < box.y1 && c.y + chipH > box.y0;
        })
        .map((n) => n.id);
      editor.set({ selection: [...new Set([...base, ...hits])] });
    };
    const onUp = () => {
      setMarquee(null);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      // Drums and piano work like a step sequencer / piano roll: a plain click on an empty cell adds a note.
      if (!active && clickToAdd && !e.shiftKey && onLane) placeNote(s, 0, { advance: false });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const onNoteDown = (e: React.MouseEvent, id: ID) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const st = editor.get();
    let selection: ID[];
    if (e.shiftKey) {
      selection = st.selection.includes(id) ? st.selection.filter((x) => x !== id) : [...st.selection, id];
    } else {
      selection = st.selection.includes(id) ? st.selection : [id];
    }
    const n = song.notes[id];
    editor.set({ selection, cursorString: n.string });
    if (selection.includes(id)) setDrag({ ids: selection, x0: e.clientX, dx: 0 });
  };

  const gridLines: JSX.Element[] = [];
  for (let t = 0; t <= total; t += step) {
    if (t % beat === 0) continue;
    gridLines.push(<line key={`g${t}`} x1={t * ppt} x2={t * ppt} y1={RULER_H} y2={height} className="tl-grid" />);
  }
  for (let t = 0; t <= total; t += beat) {
    const isBar = t % bar === 0;
    gridLines.push(
      <line
        key={`b${t}`}
        x1={t * ppt}
        x2={t * ppt}
        y1={isBar ? 0 : RULER_H - 6}
        y2={height}
        className={isBar ? 'tl-bar' : 'tl-beat'}
      />,
    );
  }

  return (
    <div className="timeline">
      <div className={`tl-gutter ${track.kind}`} style={{ height }}>
        {lanes.map((s) => (
          <div
            key={s}
            className={[
              'tl-label',
              s === ed.cursorString ? 'active' : '',
              piano && isBlackKey(track.tuning[s]) ? 'black-key' : '',
              piano && track.tuning[s] % 12 === 0 ? 'octave' : '',
            ].join(' ')}
            style={{ top: rowY(s) - rowH / 2, height: rowH }}
          >
            {laneLabel(track, s)}
          </div>
        ))}
      </div>
      <div className="tl-scroll" ref={scrollRef}>
        <svg ref={svgRef} width={width} height={height} onMouseDown={onBackgroundDown}>
          <rect x={0} y={0} width={width} height={RULER_H} className="tl-ruler" />
          {Array.from({ length: bars }, (_, i) => (
            <text key={i} x={i * bar * ppt + 5} y={16} className="tl-barnum">
              {i + 1}
            </text>
          ))}
          {piano
            ? lanes.map((s) => (
                <g key={s}>
                  {isBlackKey(track.tuning[s]) && (
                    <rect x={0} y={rowY(s) - rowH / 2} width={width} height={rowH} className="tl-blackkey" />
                  )}
                  {track.tuning[s] % 12 === 0 && (
                    <line x1={0} x2={width} y1={rowY(s) + rowH / 2} y2={rowY(s) + rowH / 2} className="tl-octave" />
                  )}
                </g>
              ))
            : lanes.map((s) => <line key={s} x1={0} x2={width} y1={rowY(s)} y2={rowY(s)} className="tl-string" />)}
          {gridLines}

          <rect
            x={ed.cursor * ppt}
            y={rowY(ed.cursorString) - rowH / 2}
            width={Math.max(step * ppt, 6)}
            height={rowH}
            className="tl-cursor-cell"
          />

          {notes.map((n) => {
            const start = dragging.has(n.id) ? Math.max(0, n.start + dragDelta) : n.start;
            const { x, w, y } = chipRect(n, start);
            const triplet = describeDuration(n.duration)?.triplet;
            const color = piano ? 'piano' : `s${n.string % 6}`;
            const cls = ['tl-note', color, selected.has(n.id) ? 'selected' : ''].join(' ');
            const label = piano
              ? w >= 30
                ? pitchName(track.tuning[n.string])
                : ''
              : isDrums
                ? isCymbal(track.tuning[n.string])
                  ? '×'
                  : '●'
                : n.fret;
            return (
              <g key={n.id} className={cls} onMouseDown={(e) => onNoteDown(e, n.id)}>
                <rect x={x} y={y} width={w} height={chipH} rx={piano ? 2 : 4} />
                <text x={x + (piano ? 3 : 5)} y={y + (piano ? 9.5 : 14)} className={piano ? 'tl-fret small' : 'tl-fret'}>
                  {label}
                </text>
                {triplet && w > 22 && !piano && (
                  <text x={x + w - 4} y={y + 8} className="tl-tuplet">
                    3
                  </text>
                )}
              </g>
            );
          })}

          {peers
            .filter((p) => p.trackId === ed.trackId && inView(p.string))
            .map((p) => (
              <g key={p.actor} pointerEvents="none">
                <line x1={p.cursor * ppt} x2={p.cursor * ppt} y1={RULER_H} y2={height} stroke={p.color} strokeWidth={2} />
                <rect
                  x={p.cursor * ppt}
                  y={rowY(p.string) - rowH / 2}
                  width={step * ppt}
                  height={rowH}
                  fill={p.color}
                  opacity={0.15}
                />
                <text x={p.cursor * ppt + 4} y={RULER_H + 10} fill={p.color} className="tl-peer">
                  {p.name}
                </text>
              </g>
            ))}

          <line x1={ed.cursor * ppt} x2={ed.cursor * ppt} y1={0} y2={height} className="tl-cursor" />
          {ed.playhead !== null && (
            <line x1={ed.playhead * ppt} x2={ed.playhead * ppt} y1={0} y2={height} className="tl-playhead" />
          )}
          {marquee && (
            <rect
              x={marquee.x0}
              y={marquee.y0}
              width={marquee.x1 - marquee.x0}
              height={marquee.y1 - marquee.y0}
              className="tl-marquee"
              pointerEvents="none"
            />
          )}
        </svg>
      </div>
    </div>
  );
}
