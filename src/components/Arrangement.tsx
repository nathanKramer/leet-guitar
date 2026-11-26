import { useEffect, useMemo, useRef, useState } from 'react';
import { isAudible } from '../editor/actions';
import * as arr from '../editor/arrange';
import type { EditorState } from '../editor/editorStore';
import { blockKey, movedTo, usedBars, type Block } from '../model/arrange';
import { sortedTracks } from '../model/commands';
import { notePitch } from '../model/drums';
import { barTicks } from '../model/durations';
import type { Note, Song } from '../model/types';

const CELL_W = 72;
/** Width of the track-name column, pinned at the left of the view. */
const NAMES_W = 120;
const ROW_H = 40;
const HEAD_H = 24;
/** Extra empty bars shown after the song, to move blocks into. */
const SPARE_BARS = 2;
const MIN_BARS = 8;
/** How far past the song's end a selection or drag can stretch the grid (and edge-scrolling can carry it). */
const MAX_EMPTY_BARS = 16;
/** How far the pointer moves before a press becomes a drag. */
const DRAG_PX = 4;
/** Empty space kept below the tracks, to start a selection box from. */
const FREE_MIN = 60;
/** Within this distance of the view's edge (or past it), a drag scrolls the view that way. */
const EDGE_PX = 40;
/** Fastest edge scroll, in pixels per frame. */
const MAX_SCROLL_PX = 24;

/** Scroll speed for a pointer at `pos` in a view spanning [lo, hi]: faster the nearer (or further past) the edge. */
function edgeSpeed(pos: number, lo: number, hi: number) {
  if (pos < lo + EDGE_PX) return -Math.min(MAX_SCROLL_PX, Math.ceil((lo + EDGE_PX - pos) / 3));
  if (pos > hi - EDGE_PX) return Math.min(MAX_SCROLL_PX, Math.ceil((pos - (hi - EDGE_PX)) / 3));
  return 0;
}

/** What a drag in progress will do when released. */
type Drag = { kind: 'move'; rows: number; bars: number; copy: boolean } | { kind: 'reorder'; at: number };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const barsLabel = (first: number, count: number) =>
  count === 1 ? `Bar ${first + 1}` : `Bars ${first + 1}–${first + count}`;

/**
 * The song bar by bar across every track: bars are columns, tracks are rows, and each block (one track's bar)
 * shows a sketch of its notes. Select blocks by clicking, dragging a rectangle or Shift-clicking, then move,
 * copy, paste, duplicate or clear them. Selecting whole bars (click the bar numbers) lets you reorder the song.
 */
export function Arrangement({ song, ed }: { song: Song; ed: EditorState }) {
  const tracks = sortedTracks(song);
  const bar = barTicks(song.meta);
  const selected = arr.selectedBlocks(ed.arrSel);
  const selectedKeys = new Set(selected.map(blockKey));
  const whole = arr.wholeBars(selected);
  /** The view: scrolls sideways through bars and up and down through tracks. */
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Width of the view left for bars (beside the pinned track names). */
  const gridW = (el: HTMLElement) => el.clientWidth - NAMES_W;
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  /** Bars that fit across the view, so the grid always reaches the right edge. */
  const [fit, setFit] = useState(MIN_BARS);
  /** Height of the view, so the empty space below the tracks fills it. */
  const [viewH, setViewH] = useState(0);
  /** The selection box being drawn from the empty space, in svg coordinates. */
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setFit(Math.max(MIN_BARS, Math.floor(gridW(el) / CELL_W)));
      setViewH(el.clientHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const used = usedBars(song);
  const lastSelected = selected.length ? Math.max(...selected.map((b) => b.bar)) : -1;
  const bars = Math.max(
    fit,
    used + SPARE_BARS,
    Math.min(used + MAX_EMPTY_BARS, lastSelected + 2 + (drag?.kind === 'move' ? Math.max(0, drag.bars) : 0)),
    Math.floor((ed.playhead ?? ed.cursor) / bar) + 1,
  );
  const width = bars * CELL_W;
  /** Bottom of the last track; below it is empty space for selection boxes. */
  const height = HEAD_H + tracks.length * ROW_H;
  const svgH = Math.max(height + FREE_MIN, viewH);
  const rowOf = new Map(tracks.map((t, i) => [t.id, i]));

  /** Each track's notes by bar, with the pitch span used to sketch them. */
  const sketch = useMemo(() => {
    const out = new Map<string, { byBar: Map<number, Note[]>; lo: number; hi: number }>();
    for (const t of Object.values(song.tracks)) out.set(t.id, { byBar: new Map(), lo: Infinity, hi: -Infinity });
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
  }, [song.notes, song.tracks, bar]);

  // Keep the focused block in view.
  const focus = ed.arrSel.focus;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !focus) return;
    const x = focus.bar * CELL_W;
    if (x < el.scrollLeft) el.scrollLeft = x - CELL_W / 2;
    else if (x + CELL_W > el.scrollLeft + gridW(el)) el.scrollLeft = x + CELL_W * 1.5 - gridW(el);
  }, [focus?.bar]); // eslint-disable-line react-hooks/exhaustive-deps

  // While playing, follow the playhead.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || ed.playhead === null) return;
    const x = (ed.playhead / bar) * CELL_W;
    if (x < el.scrollLeft || x > el.scrollLeft + gridW(el) - CELL_W) el.scrollLeft = x - CELL_W;
  }, [ed.playhead !== null && Math.floor(ed.playhead / bar)]); // eslint-disable-line react-hooks/exhaustive-deps

  const pointAt = (ev: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };
  /** The block under a point, kept inside the grid (for drags that stray outside it). */
  const blockAt = (x: number, y: number): Block => {
    const row = Math.min(tracks.length - 1, Math.max(0, Math.floor((y - HEAD_H) / ROW_H)));
    return { trackId: tracks[row].id, bar: Math.max(0, Math.floor(x / CELL_W)) };
  };

  /**
   * Follow a drag until the button is released. While the pointer is near (or past) an edge of the view, the view
   * keeps scrolling that way, and `move` is re-applied as the content slides under the pointer. Scrolling waits
   * until `active()` says the press has become a drag.
   */
  const trackDrag = (move: (ev: PointerEvent) => void, up: (ev: PointerEvent) => void, active = () => true) => {
    let last: PointerEvent | null = null;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const el = scrollRef.current;
      if (!last || !el || !active()) return;
      const r = el.getBoundingClientRect();
      const { scrollLeft, scrollTop } = el;
      // The bars start right of the pinned track names, so that's the left edge.
      el.scrollLeft += edgeSpeed(last.clientX, r.left + NAMES_W, r.left + el.clientWidth);
      el.scrollTop += edgeSpeed(last.clientY, r.top, r.top + el.clientHeight);
      if (el.scrollLeft !== scrollLeft || el.scrollTop !== scrollTop) move(last);
    };
    const onMove = (ev: PointerEvent) => {
      last = ev;
      move(ev);
    };
    const onUp = (ev: PointerEvent) => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      up(ev);
    };
    raf = requestAnimationFrame(tick);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !tracks.length) return;
    const p0 = pointAt(e);
    const b0 = Math.max(0, Math.floor(p0.x / CELL_W));
    const block = p0.y < HEAD_H ? null : blockAt(p0.x, p0.y);
    const sel = arr.selectedBlocks();
    const range = arr.wholeBars(sel);
    const base = e.shiftKey ? sel : [];

    // Below the tracks: drag a box; every block it touches is selected. A plain click there deselects.
    if (p0.y >= height) {
      if (!e.shiftKey) arr.clearSelection();
      const onMove = (ev: PointerEvent) => {
        const p = pointAt(ev);
        const b = {
          x0: Math.min(p0.x, p.x),
          x1: Math.max(p0.x, p.x),
          y0: Math.min(p0.y, p.y),
          y1: Math.max(p0.y, p.y),
        };
        setBox(b);
        const r0 = Math.max(0, Math.floor((b.y0 - HEAD_H) / ROW_H));
        const r1 = Math.min(tracks.length - 1, Math.floor((b.y1 - HEAD_H) / ROW_H));
        if (b.y1 <= HEAD_H || r0 > r1) return arr.setSelection(base, null);
        const from = { trackId: tracks[r0].id, bar: Math.max(0, Math.floor(b.x0 / CELL_W)) };
        const to = { trackId: tracks[r1].id, bar: Math.max(0, Math.floor(b.x1 / CELL_W)) };
        arr.setSelection([...base, ...arr.blockRect(from, to)], from, to);
      };
      trackDrag(onMove, () => setBox(null));
      return;
    }

    // Pressing on the selection drags it; anywhere else selects (and dragging draws a rectangle).
    let mode: 'blocks' | 'bars' | 'move' | 'reorder';
    const onSelection = block
      ? sel.some((b) => blockKey(b) === blockKey(block))
      : !!range && b0 >= range.first && b0 < range.first + range.count;
    if (!e.shiftKey && onSelection) {
      mode = range ? 'reorder' : 'move';
    } else if (block) {
      mode = 'blocks';
      if (e.shiftKey) arr.toggleBlock(block);
      else arr.setSelection([block], block);
    } else {
      mode = 'bars';
      arr.selectBars(b0, b0, base);
    }

    let dragging = false;
    let result: Drag | null = null;
    const onMove = (ev: PointerEvent) => {
      if (!dragging && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < DRAG_PX) return;
      dragging = true;
      const p = pointAt(ev);
      if (mode === 'blocks') {
        const to = blockAt(p.x, p.y);
        arr.setSelection([...base, ...arr.blockRect(block!, to)], block, to);
      } else if (mode === 'bars') {
        arr.selectBars(b0, Math.max(0, Math.floor(p.x / CELL_W)), base);
      } else if (mode === 'move') {
        const m = arr.clampMove(Math.round((p.y - p0.y) / ROW_H), Math.round((p.x - p0.x) / CELL_W), sel);
        result = { kind: 'move', rows: m.rows, bars: m.bars, copy: ev.altKey };
        setDrag(result);
      } else {
        result = { kind: 'reorder', at: Math.min(bars, Math.max(0, Math.round(p.x / CELL_W))) };
        setDrag(result);
      }
    };
    const onUp = (ev: PointerEvent) => {
      setDrag(null);
      const done = result as Drag | null;
      if (done?.kind === 'move') arr.moveBlocksBy(done.rows, done.bars, ev.altKey);
      else if (done?.kind === 'reorder') arr.reorderBars(done.at);
      else if (!dragging && onSelection && !e.shiftKey) {
        // A plain click on part of a bigger selection narrows it to what was clicked.
        if (block && sel.length > 1) arr.setSelection([block], block);
        else if (!block && range && range.count > 1) arr.selectBars(b0, b0);
      }
    };
    trackDrag(onMove, onUp, () => dragging);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const { x, y } = pointAt(e);
    if (y >= HEAD_H && y < height) arr.openInEditor(blockAt(x, y));
  };

  /** Clicking a track's name selects its whole part (Shift adds it to the selection). */
  const selectTrackRow = (trackId: string, add: boolean) => {
    const last = Math.max(0, used - 1);
    const rect = arr.blockRect({ trackId, bar: 0 }, { trackId, bar: last });
    arr.setSelection([...(add ? selected : []), ...rect], { trackId, bar: 0 }, { trackId, bar: 0 });
  };

  const status = (() => {
    if (drag?.kind === 'reorder' && whole) {
      return movedTo(whole, drag.at) === null
        ? 'Drop somewhere else to move'
        : `Move ${barsLabel(whole.first, whole.count).toLowerCase()} to before bar ${drag.at + 1}`;
    }
    if (drag?.kind === 'move') {
      const verb = drag.copy ? 'Copy' : 'Move';
      const firstBar = Math.min(...selected.map((b) => b.bar)) + drag.bars;
      const shift = drag.rows ? `, ${plural(Math.abs(drag.rows), 'track')} ${drag.rows > 0 ? 'down' : 'up'}` : '';
      const hint = drag.copy ? '' : '; hold Alt to copy';
      return `${verb} ${plural(selected.length, 'block')} to bar ${firstBar + 1}${shift} (replaces what's there${hint})`;
    }
    if (whole) return `${barsLabel(whole.first, whole.count)} selected in every track · drag to reorder`;
    if (selected.length === 1) return `${song.tracks[selected[0].trackId]?.name}, bar ${selected[0].bar + 1}`;
    if (selected.length) return `${plural(selected.length, 'block')} selected`;
    return 'Click a block to select it; drag to select several';
  })();

  const ppt = CELL_W / bar;
  const playheadX = ed.playhead !== null ? ed.playhead * ppt : null;
  const has = selected.length > 0;
  const cell = (b: Block, dRows = 0, dBars = 0) => ({
    x: (b.bar + dBars) * CELL_W,
    y: HEAD_H + (rowOf.get(b.trackId)! + dRows) * ROW_H,
    width: CELL_W,
    height: ROW_H,
  });

  return (
    <section className="arrangement" aria-label="Arrangement">
      <div className="ar-tools">
        <span className="ar-status" role="status">
          {status}
        </span>
        <span className="ar-actions">
          <button onClick={() => arr.nudge(-1)} disabled={!has} title="Move the selection one bar earlier (Alt+←)">
            ◀
          </button>
          <button onClick={() => arr.nudge(1)} disabled={!has} title="Move the selection one bar later (Alt+→)">
            ▶
          </button>
          <button onClick={arr.copy} disabled={!has} title="Copy the selected blocks (Ctrl+C)">
            Copy
          </button>
          <button onClick={arr.paste} title="Paste at the selection, replacing what's there (Ctrl+V)">
            Paste
          </button>
          <button onClick={arr.duplicate} disabled={!has} title="Repeat the selection after itself (Ctrl+D)">
            Duplicate
          </button>
          <button onClick={arr.clear} disabled={!has} title="Empty the selected blocks (Del)">
            Clear
          </button>
          <button onClick={arr.insertBar} title="Insert an empty bar in every track before the selection (I)">
            Insert bar
          </button>
          <button
            className="danger"
            onClick={arr.removeBars}
            disabled={!has}
            title="Remove the selected bars from every track; later bars move back (Shift+Del)"
          >
            Remove bars
          </button>
        </span>
      </div>
      <div className="ar-body" ref={scrollRef}>
        <div className="ar-names" style={{ paddingTop: HEAD_H, width: NAMES_W }}>
          {tracks.map((t) => (
            <div
              key={t.id}
              className={[
                'ar-name',
                t.id === ed.trackId ? 'active' : '',
                isAudible(t.id, ed) ? '' : 'silent-track',
              ].join(' ')}
              style={{ height: ROW_H }}
              onClick={(e) => selectTrackRow(t.id, e.shiftKey)}
              title={`${t.name}: click to select the whole part`}
            >
              {t.name}
            </div>
          ))}
        </div>
        <div className="ar-scroll">
          <svg
            ref={svgRef}
            width={width}
            height={svgH}
            onPointerDown={onPointerDown}
            onDoubleClick={onDoubleClick}
            className={drag ? 'dragging' : undefined}
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
            {whole && (
              <rect
                x={whole.first * CELL_W}
                y={0}
                width={whole.count * CELL_W}
                height={HEAD_H}
                className="ar-col-sel"
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
            {selected.map((b) => (
              <rect
                key={blockKey(b)}
                {...cell(b)}
                className={drag?.kind === 'move' && !drag.copy ? 'ar-block-sel lifted' : 'ar-block-sel'}
              />
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
                        className={
                          selectedKeys.has(blockKey({ trackId: t.id, bar: b })) ? 'ar-clip selected' : 'ar-clip'
                        }
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
            {focus && rowOf.has(focus.trackId) && !drag && <rect {...cell(focus)} className="ar-focus" />}
            {drag?.kind === 'move' &&
              (drag.rows !== 0 || drag.bars !== 0) &&
              selected.map((b) => <rect key={blockKey(b)} {...cell(b, drag.rows, drag.bars)} className="ar-ghost" />)}
            <line x1={ed.cursor * ppt} x2={ed.cursor * ppt} y1={0} y2={height} className="ar-cursor" />
            {box && (
              <rect x={box.x0} y={box.y0} width={box.x1 - box.x0} height={box.y1 - box.y0} className="ar-marquee" />
            )}
            {playheadX !== null && <line x1={playheadX} x2={playheadX} y1={0} y2={height} className="tl-playhead" />}
            {drag?.kind === 'reorder' && whole && (
              <g className={movedTo(whole, drag.at) !== null ? 'ar-drop' : 'ar-drop invalid'}>
                <line x1={drag.at * CELL_W} x2={drag.at * CELL_W} y1={0} y2={height} />
                <path d={`M${drag.at * CELL_W - 6} 0 h12 l-6 7 z`} />
              </g>
            )}
          </svg>
        </div>
      </div>
    </section>
  );
}
