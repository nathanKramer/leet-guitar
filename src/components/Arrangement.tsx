import { useEffect, useMemo, useRef, useState } from 'react';
import { isAudible, selectTrack } from '../editor/actions';
import {
  deleteSelectedBars,
  duplicateSelectedBars,
  insertBar,
  moveSelectedBars,
  nudgeSelectedBars,
  openInEditor,
  selectBar,
  selectedBars,
} from '../editor/arrange';
import type { EditorState } from '../editor/editorStore';
import { movedTo, usedBars } from '../model/arrange';
import { sortedTracks } from '../model/commands';
import { notePitch } from '../model/drums';
import { barTicks } from '../model/durations';
import type { Note, Song } from '../model/types';

const CELL_W = 72;
const ROW_H = 40;
const HEAD_H = 24;
/** Extra empty bars shown after the song, to move bars into. */
const SPARE_BARS = 2;
const MIN_BARS = 8;
/** How far the pointer moves before a press on the selection becomes a drag. */
const DRAG_PX = 4;
/** Within this distance of the scroller's edge, a drag scrolls it. */
const EDGE_PX = 40;

const barLabel = (first: number, count: number) =>
  count === 1 ? `Bar ${first + 1}` : `Bars ${first + 1}–${first + count}`;

/**
 * The song bar by bar across every track: bars are columns, tracks are rows, and each cell shows a sketch of
 * its notes. Select bars (click, Shift-click) and drag them, or use the buttons, to rearrange the whole song.
 */
export function Arrangement({ song, ed }: { song: Song; ed: EditorState }) {
  const tracks = sortedTracks(song);
  const bar = barTicks(song.meta);
  const range = selectedBars(ed.barSel);
  const scrollRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  /** While dragging: the bar boundary the selection would be dropped at. */
  const [drop, setDrop] = useState<number | null>(null);
  /** Bars that fit across the view, so the grid always reaches the right edge. */
  const [fit, setFit] = useState(MIN_BARS);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFit(Math.max(MIN_BARS, Math.floor(el.clientWidth / CELL_W))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const bars = Math.max(
    fit,
    usedBars(song) + SPARE_BARS,
    range ? range.first + range.count + 1 : 0,
    Math.floor((ed.playhead ?? ed.cursor) / bar) + 1,
  );
  const width = bars * CELL_W;
  const height = HEAD_H + tracks.length * ROW_H;

  /** Each track's notes by bar, with the pitch span used to sketch them. */
  const sketch = useMemo(() => {
    const out = new Map<string, { byBar: Map<number, Note[]>; lo: number; hi: number }>();
    for (const t of tracks) out.set(t.id, { byBar: new Map(), lo: Infinity, hi: -Infinity });
    for (const n of Object.values(song.notes)) {
      const t = song.tracks[n.trackId];
      const s = t && out.get(t.id);
      if (!s) continue;
      const b = Math.floor(n.start / bar);
      s.byBar.set(b, [...(s.byBar.get(b) ?? []), n]);
      // Drums are sketched by kit piece (top lane at the top), everything else by pitch.
      const y = t.kind === 'drums' ? -n.string : notePitch(t, n);
      s.lo = Math.min(s.lo, y);
      s.hi = Math.max(s.hi, y);
    }
    return out;
  }, [song.notes, song.tracks, bar]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the end of the selection that was last moved in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !ed.barSel) return;
    const x = ed.barSel.focus * CELL_W;
    if (x < el.scrollLeft) el.scrollLeft = x - CELL_W / 2;
    else if (x + CELL_W > el.scrollLeft + el.clientWidth) el.scrollLeft = x + CELL_W * 1.5 - el.clientWidth;
  }, [ed.barSel?.focus]); // eslint-disable-line react-hooks/exhaustive-deps

  // While playing, follow the playhead.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || ed.playhead === null) return;
    const x = (ed.playhead / bar) * CELL_W;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - CELL_W) el.scrollLeft = x - CELL_W;
  }, [ed.playhead !== null && Math.floor(ed.playhead / bar)]); // eslint-disable-line react-hooks/exhaustive-deps

  const pointAt = (ev: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const { x, y } = pointAt(e);
    const b = Math.max(0, Math.floor(x / CELL_W));
    const row = y < HEAD_H ? null : Math.floor((y - HEAD_H) / ROW_H);
    const track = row !== null ? tracks[row] : undefined;
    if (track) selectTrack(track.id);
    const current = selectedBars();
    const inSelection = !!current && b >= current.first && b < current.first + current.count;
    if (e.shiftKey || !inSelection) {
      selectBar(b, e.shiftKey);
      if (e.shiftKey) return;
    }
    // Pressing on the selection (including a bar just selected) starts a drag once the pointer moves.
    const el = scrollRef.current!;
    const x0 = e.clientX;
    let dragging = false;
    let at: number | null = null;
    const onMove = (ev: PointerEvent) => {
      if (!dragging && Math.abs(ev.clientX - x0) < DRAG_PX) return;
      dragging = true;
      const r = el.getBoundingClientRect();
      if (ev.clientX < r.left + EDGE_PX) el.scrollLeft -= 12;
      else if (ev.clientX > r.right - EDGE_PX) el.scrollLeft += 12;
      at = Math.min(bars, Math.max(0, Math.round(pointAt(ev).x / CELL_W)));
      setDrop(at);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setDrop(null);
      if (dragging && at !== null) moveSelectedBars(at);
      // A plain click inside a multi-bar selection narrows it to that bar.
      else if (!dragging && inSelection && current!.count > 1) selectBar(b);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const { x, y } = pointAt(e);
    const row = Math.floor((y - HEAD_H) / ROW_H);
    const track = y >= HEAD_H ? tracks[row] : undefined;
    if (track) openInEditor(track.id, Math.floor(x / CELL_W));
  };

  const dropValid = drop !== null && range !== null && movedTo(range, drop) !== null;
  const status =
    drop !== null && range
      ? dropValid
        ? `Move ${barLabel(range.first, range.count).toLowerCase()} to before bar ${drop + 1}`
        : 'Drop somewhere else to move'
      : range
        ? `${barLabel(range.first, range.count)} selected`
        : 'Click a bar to select it';

  const ppt = CELL_W / bar;
  const playheadX = ed.playhead !== null ? ed.playhead * ppt : null;

  return (
    <section className="arrangement" aria-label="Arrangement">
      <div className="ar-tools">
        <span className="ar-status" role="status">
          {status}
        </span>
        <span className="ar-actions">
          <button
            onClick={() => nudgeSelectedBars(-1)}
            disabled={!range || range.first === 0}
            title="Move the selected bars one bar earlier (Alt+←)"
          >
            ◀ Move
          </button>
          <button
            onClick={() => nudgeSelectedBars(1)}
            disabled={!range}
            title="Move the selected bars one bar later (Alt+→)"
          >
            Move ▶
          </button>
          <button
            onClick={duplicateSelectedBars}
            disabled={!range}
            title="Repeat the selected bars after themselves (Ctrl+D)"
          >
            Duplicate
          </button>
          <button onClick={insertBar} title="Insert an empty bar before the selection (I)">
            Insert bar
          </button>
          <button
            className="danger"
            onClick={deleteSelectedBars}
            disabled={!range}
            title="Delete the selected bars from every track (Del)"
          >
            Delete
          </button>
        </span>
      </div>
      <div className="ar-body">
        <div className="ar-names" style={{ paddingTop: HEAD_H }}>
          {tracks.map((t) => (
            <div
              key={t.id}
              className={[
                'ar-name',
                t.id === ed.trackId ? 'active' : '',
                isAudible(t.id, ed) ? '' : 'silent-track',
              ].join(' ')}
              style={{ height: ROW_H }}
              onClick={() => selectTrack(t.id)}
              title={t.name}
            >
              {t.name}
            </div>
          ))}
        </div>
        <div className="ar-scroll" ref={scrollRef}>
          <svg
            ref={svgRef}
            width={width}
            height={height}
            onPointerDown={onPointerDown}
            onDoubleClick={onDoubleClick}
            className={drop !== null ? 'dragging' : undefined}
          >
            <rect x={0} y={0} width={width} height={HEAD_H} className="ar-head" />
            {tracks.map((t, i) => (
              <rect
                key={t.id}
                x={0}
                y={HEAD_H + i * ROW_H}
                width={width}
                height={ROW_H}
                className={i % 2 ? 'ar-row odd' : 'ar-row'}
              />
            ))}
            {range && (
              <rect
                x={range.first * CELL_W}
                y={0}
                width={range.count * CELL_W}
                height={height}
                className={drop !== null ? 'ar-sel lifted' : 'ar-sel'}
              />
            )}
            {Array.from({ length: bars }, (_, b) => (
              <g key={b}>
                <line x1={b * CELL_W} x2={b * CELL_W} y1={0} y2={height} className="ar-barline" />
                <text x={b * CELL_W + 6} y={16} className="ar-barnum">
                  {b + 1}
                </text>
              </g>
            ))}
            {tracks.map((t, i) => {
              const s = sketch.get(t.id)!;
              const top = HEAD_H + i * ROW_H;
              const span = Math.max(1, s.hi - s.lo);
              const yOf = (n: Note) => {
                const v = t.kind === 'drums' ? -n.string : notePitch(t, n);
                return top + 7 + (s.hi === s.lo ? (ROW_H - 14) / 2 : ((s.hi - v) / span) * (ROW_H - 14));
              };
              return (
                <g key={t.id} className={['ar-track', t.kind, isAudible(t.id, ed) ? '' : 'silent'].join(' ')}>
                  {[...s.byBar].map(([b, notes]) => (
                    <g key={b}>
                      <rect
                        x={b * CELL_W + 2}
                        y={top + 3}
                        width={CELL_W - 4}
                        height={ROW_H - 6}
                        rx={4}
                        className="ar-clip"
                      />
                      {notes.map((n) => (
                        <rect
                          key={n.id}
                          x={n.start * ppt}
                          y={yOf(n) - 1}
                          width={Math.max(2, Math.min(n.duration * ppt, width - n.start * ppt) - 1)}
                          height={2.5}
                          className="ar-note"
                        />
                      ))}
                    </g>
                  ))}
                </g>
              );
            })}
            <line x1={ed.cursor * ppt} x2={ed.cursor * ppt} y1={0} y2={height} className="ar-cursor" />
            {playheadX !== null && <line x1={playheadX} x2={playheadX} y1={0} y2={height} className="tl-playhead" />}
            {drop !== null && (
              <g className={dropValid ? 'ar-drop' : 'ar-drop invalid'}>
                <line x1={drop * CELL_W} x2={drop * CELL_W} y1={0} y2={height} />
                <path d={`M${drop * CELL_W - 6} 0 h12 l-6 7 z`} />
              </g>
            )}
          </svg>
        </div>
      </div>
    </section>
  );
}
